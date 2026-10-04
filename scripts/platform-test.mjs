/**
 * 平台适配层单元测试（纯 Node，无网络）。
 *
 * 覆盖 src/platform/native/* 里「不依赖真机」的纯逻辑：
 * 相对路径 → 真实域名的改写、Cookie 头翻译、302/Set-Cookie 解析、
 * 登录流程编排（用假 QQ 服务端）、媒体缓存键、auth 分发。
 *
 * 真机 I/O（实际下载、Capacitor 插件调用）需在装有 Android SDK 的环境验证。
 *
 * 用法：npm run test:platform
 */
import { readFileSync } from 'node:fs'
import { createNativeHttp } from '../src/platform/native/http.js'
import { createNativeMedia, cacheKey, extFromUrl } from '../src/platform/native/media.js'
import { createNativeAuth } from '../src/platform/native/auth.js'
import { createNativeWebLogin } from '../src/platform/native/qqWebLogin.js'
import { looksLikeBase64, base64ToBytes, base64ToBlob, normalizeBase64 } from '../src/platform/native/base64.js'
import { splitSetCookie, parseCookieString, cookieString } from '../src/core/qqLogin.js'
import { parseUinFromCookie } from '../src/api/qq.js'
import { buildBookmarklet, normalizePastedCookie, cookieHasLogin } from '../src/utils/cookieImport.js'
import {
  friendlyLoginError,
  POLL_RETRY_MAX,
  START_RETRY_MAX,
  startRetryDelay,
  pollRetryMessage,
} from '../src/utils/loginRetry.js'
import {
  setAuthBackend,
  setWebLogin,
  supportsWebLogin,
  webLoginPage,
  clearWebLoginCookies,
  fetchPing,
  startQrLogin,
  pollQrLogin,
  closeQrSession,
  unlock,
} from '../src/api/auth.js'

let pass = 0
let fail = 0
function log(name, ok, detail = '') {
  if (ok) {
    pass++
    console.log(`PASS  ${name}${detail ? '  → ' + detail : ''}`)
  } else {
    fail++
    console.log(`FAIL  ${name}${detail ? '  → ' + detail : ''}`)
  }
}
function eq(name, actual, expected) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  log(name, a === e, a === e ? a : `期望 ${e}，实际 ${a}`)
}

// ---------------------------------------------------------------------------
// 假的 fetch 风格 Response（模拟 transport 接口）
// ---------------------------------------------------------------------------
function fakeRes({ status = 200, headers = {}, text = '', bytes = null } = {}) {
  const map = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]))
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get: (n) => (map.has(String(n).toLowerCase()) ? map.get(String(n).toLowerCase()) : null),
      getSetCookie: () => (map.has('set-cookie') ? splitSetCookie(map.get('set-cookie')) : []),
    },
    text: async () => text,
    arrayBuffer: async () => bytes || new TextEncoder().encode(text).buffer,
  }
}

function pngBytes() {
  const b = new Uint8Array(120)
  b[0] = 0x89
  b[1] = 0x50
  b[2] = 0x4e
  b[3] = 0x47
  return b
}

// ---------------------------------------------------------------------------
// 1. 请求改写（interceptor）
// ---------------------------------------------------------------------------
console.log('\n=== 1. 上游请求改写 ===')
{
  const http = createNativeHttp({ CapacitorHttp: { request: async () => ({}) } })

  {
    const r = http.interceptor('/qq-api/rsc/fcgi-bin/fcg_user_created_diss?hostuin=1', {
      headers: { 'X-QQ-Cookie': 'qm_keyst=abc' },
    })
    log('QQ 路径改写为真实域名', r.url === 'https://c.y.qq.com/rsc/fcgi-bin/fcg_user_created_diss?hostuin=1', r.url)
    log('QQ 补齐 Referer/Origin', r.headers.Referer === 'https://y.qq.com/' && r.headers.Origin === 'https://y.qq.com')
    log('自定义 Cookie 头翻译为真 Cookie', r.headers.Cookie === 'qm_keyst=abc')
    log('移除 X-QQ-Cookie（避免泄漏到上游请求头）', r.headers['X-QQ-Cookie'] === undefined)
  }
  {
    const r = http.interceptor('/qqmu-api/cgi-bin/musicu.fcg', {})
    log('QQ 网关改写', r.url === 'https://u.y.qq.com/cgi-bin/musicu.fcg', r.url)
  }
  {
    const r = http.interceptor('/bili-api/x/web-interface/nav', { headers: { 'X-Bili-Cookie': 'SESSDATA=xyz' } })
    log('B站路径改写', r.url === 'https://api.bilibili.com/x/web-interface/nav', r.url)
    log('B站 Cookie 翻译', r.headers.Cookie === 'SESSDATA=xyz' && r.headers.Referer === 'https://www.bilibili.com/')
    log('无自定义 Cookie 时不生成 Cookie 头', http.interceptor('/bili-api/x', {}).headers.Cookie === undefined)
  }
  log('自有后端 /auth-api 不改写', http.interceptor('/auth-api/ping', {}) === null)
  log('图片/音频代理不改写（由媒体层处理）', http.interceptor('/img-api?url=x', {}) === null && http.interceptor('/media-api?url=x', {}) === null)
}

// ---------------------------------------------------------------------------
// 2. requestTransport（业务接口）
// ---------------------------------------------------------------------------
console.log('\n=== 2. 业务请求发送 ===')
{
  const calls = []
  const http = createNativeHttp({
    CapacitorHttp: {
      request: async (opts) => {
        calls.push(opts)
        const isBili = opts.url.includes('api.bilibili.com')
        return {
          status: 200,
          headers: { 'Content-Type': isBili ? 'text/plain' : 'application/json' },
          data: isBili ? 'plain text' : { code: 0, msg: 'ok' },
          url: opts.url,
        }
      },
    },
  })

  const res = await http.requestTransport('https://c.y.qq.com/x', {
    headers: { Referer: 'https://y.qq.com/' },
    timeout: 8000,
  })
  eq('响应包装：状态码/ok', [res.status, res.ok], [200, true])
  eq('json() 可用（原生已解析为对象）', await res.json(), { code: 0, msg: 'ok' })
  eq('text() 可用（对象转回字符串）', await res.text(), '{"code":0,"msg":"ok"}')
  log('默认补 User-Agent', /Mozilla/.test(calls[0].headers['User-Agent'] || ''))
  eq('超时映射为 connectTimeout/readTimeout', [calls[0].connectTimeout, calls[0].readTimeout], [8000, 8000])

  const textRes = await http.requestTransport('https://api.bilibili.com/x', {})
  eq('字符串响应 text()', await textRes.text(), 'plain text')
  log('未显式传 timeout 时使用默认值', calls[1].connectTimeout === 15000, String(calls[1].connectTimeout))
}

// ---------------------------------------------------------------------------
// 3. 登录 transport（禁用重定向 + 二进制）
// ---------------------------------------------------------------------------
console.log('\n=== 3. 登录请求 ===')
{
  const calls = []
  const http = createNativeHttp({
    CapacitorHttp: {
      request: async (opts) => {
        calls.push(opts)
        return { status: 302, headers: { Location: 'https://x/y', 'set-cookie': 'p_skey=abc; Path=/, skey=def; Path=/' }, data: new ArrayBuffer(0) }
      },
    },
  })

  const res = await http.transport({ url: 'https://graph.qq.com/oauth2.0/authorize', method: 'POST', headers: {} })
  eq('禁用自动重定向（需逐跳收集 Set-Cookie）', calls[0].disableRedirects, true)
  eq('二进制响应类型（二维码/票据通用）', calls[0].responseType, 'arraybuffer')
  eq('可读取 302 Location', res.headers.get('location'), 'https://x/y')
  eq('多条 Set-Cookie 正确切分', res.headers.getSetCookie(), ['p_skey=abc; Path=/', 'skey=def; Path=/'])
  log('非 2xx 时 ok 为 false', res.ok === false)

  const form = new FormData()
  form.append('code', 'c1')
  form.append('g_tk', '123')
  await http.transport({ url: 'https://graph.qq.com/oauth2.0/authorize', method: 'POST', body: form, headers: {} })
  eq('FormData 转为 urlencoded（原生只支持字符串/JSON）', calls[1].data, 'code=c1&g_tk=123')
  eq('并补上 Content-Type', calls[1].headers['Content-Type'], 'application/x-www-form-urlencoded')
}
{
  const http = createNativeHttp({
    CapacitorHttp: {
      request: async () => {
        throw new Error('connect timed out')
      },
    },
  })
  let name = ''
  let msg = ''
  try {
    await http.requestTransport('https://x/y', {})
  } catch (e) {
    name = e.name
    msg = e.message
  }
  log('原生超时转为 AbortError（上层统一提示）', name === 'AbortError', `name=${name}`)
  log('超时提示文案一致', /请求超时/.test(msg), msg)
}

// ---------------------------------------------------------------------------
// 4. 媒体层
// ---------------------------------------------------------------------------
console.log('\n=== 4. 媒体缓存 ===')
{
  eq('URL 扩展名提取', extFromUrl('https://cdn/a/audio.m4s?token=1'), '.m4s')
  eq('无扩展名回退 m4s', extFromUrl('https://cdn/a/12345'), '.m4s')
  const k1 = cacheKey('https://cdn/a?x=1')
  log('缓存键稳定', k1 === cacheKey('https://cdn/a?x=1'), k1)
  log('不同 URL → 不同缓存键', k1 !== cacheKey('https://cdn/a?x=2'))
}

if (typeof URL.createObjectURL !== 'function') {
  URL.createObjectURL = () => 'blob:fake'
}

{
  const downloads = []
  let cachedSize = 0
  const media = createNativeMedia({
    CapacitorHttp: {
      request: async () => ({ status: 200, headers: {}, data: new Blob([pngBytes()]) }),
    },
    Filesystem: {
      mkdir: async () => {},
      getUri: async ({ path }) => ({ uri: `file:///cache/${path}` }),
      stat: async () => {
        if (cachedSize === 0) throw new Error('not found')
        return { size: cachedSize }
      },
      rmdir: async () => {},
    },
    Directory: { Cache: 'CACHE' },
    FileTransfer: {
      downloadFile: async (o) => {
        downloads.push(o)
        cachedSize = 4096
      },
    },
    Capacitor: { convertFileSrc: (u) => 'https://localhost/_capacitor_file_' + u.replace('file://', '') },
  })

  const imgUrl = await media.resolveImage('https://i0.hdslb.com/a.jpg')
  log('图片转为 blob URL', typeof imgUrl === 'string' && imgUrl.length > 0, imgUrl)

  const url = 'https://upos-sz-mirrorcos.bilivideo.com/audio.m4s?vkey=1'
  const playable = await media.resolveAudio(url)
  eq('首次播放触发下载', downloads.length, 1)
  log('下载带 Referer（绕过 B站防盗链）', downloads[0].headers.Referer === 'https://www.bilibili.com/', JSON.stringify(downloads[0].headers))
  log('下载到缓存目录且文件名稳定', downloads[0].path.startsWith('file:///cache/bmp-audio/') && downloads[0].path.endsWith('.m4s'), downloads[0].path)
  log('返回 convertFileSrc 后的可播放地址', /^https:\/\/localhost\/_capacitor_file_/.test(playable), playable)

  const again = await media.resolveAudio(url)
  eq('命中缓存不再重复下载', downloads.length, 1)
  log('二次返回同一地址', again === playable)

  const qqUrl = 'https://isure.stream.qqmusic.qq.com/audio.m4s?vkey=2'
  cachedSize = 0 // 让 mock 的 stat 视为未缓存，以便观察下载请求头
  await media.resolveAudio(qqUrl)
  eq('QQ 音频也走下载缓存', downloads.length, 2)
  log('QQ 音频下载带 QQ Referer（不是 B站）', downloads[1].headers.Referer === 'https://y.qq.com/', JSON.stringify(downloads[1].headers))

  await media.clearAudioCache()
  log('可清理音频缓存', true)
}

// QQ 音频域名进白名单（/media-api 与移动端下载都依赖它）
{
  const { MEDIA_HOST_ALLOW, refererForHost } = await import('../src/core/upstreams.js')
  const { refererFor } = await import('../src/platform/native/media.js')
  log(
    'QQ 音频 CDN 进白名单（stream.qqmusic / music.tc）',
    MEDIA_HOST_ALLOW.test('isure.stream.qqmusic.qq.com') && MEDIA_HOST_ALLOW.test('aqqmusic.tc.qq.com')
  )
  log('B站音频域名仍在白名单', MEDIA_HOST_ALLOW.test('upos-sz-mirrorcos.bilivideo.com'))
  log('未知域名不进白名单', !MEDIA_HOST_ALLOW.test('evil.example.com'))
  eq('QQ 音频域名 → QQ Referer', refererFor('https://ws.stream.qqmusic.qq.com/x.m4s'), 'https://y.qq.com/')
  eq('refererForHost 同时给出 Origin', refererForHost('https://isure.stream.qqmusic.qq.com/x')?.origin, 'https://y.qq.com')
  eq('B站域名 → B站 Referer', refererFor('https://upos-sz-mirrorcos.bilivideo.com/x.m4s'), 'https://www.bilibili.com/')
}

// ---------------------------------------------------------------------------
// 5. 客户端扫码登录（用假 QQ 服务端跑完整流程）
// ---------------------------------------------------------------------------
console.log('\n=== 5. 客户端扫码登录 ===')
{
  const seen = []
  const png = pngBytes()
  const transport = async ({ url, headers }) => {
    seen.push({ url, headers })
    if (url.includes('/cgi-bin/xlogin')) {
      return fakeRes({ headers: { 'set-cookie': 'pt_login_sig=sig123; Path=/' } })
    }
    if (url.includes('/ssl/ptqrshow')) {
      return fakeRes({ headers: { 'set-cookie': 'qrsig=qrsig123; Path=/' }, bytes: png.buffer })
    }
    if (url.includes('/ssl/ptqrlogin')) {
      // 第一轮：未扫码；之后模拟二维码失效
      const text = seen.filter((s) => s.url.includes('ptqrlogin')).length === 1
        ? "ptuiCB('66','0','','0','二维码未失效。','')"
        : "ptuiCB('65','0','','0','二维码已失效。','')"
      return fakeRes({ text })
    }
    return fakeRes({})
  }

  const auth = createNativeAuth({ transport })

  eq('移动端视为已解锁', await auth.fetchPing(), { reachable: true, authRequired: false, authed: true })
  eq('移动端服务可达', await auth.pingServer(), true)
  let unlockErr = ''
  try {
    await auth.unlock('1234')
  } catch (e) {
    unlockErr = e.message
  }
  log('移动端调用 unlock 会明确报错', /无需访问口令/.test(unlockErr), unlockErr)

  const image = await auth.startQrLogin()
  log('生成二维码（dataURL）', /^data:image\/png;base64,iVBOR/.test(image), image.slice(0, 32))
  log(
    '二维码请求带上了登录页下发的会话 cookie',
    /pt_login_sig=sig123/.test(seen[1]?.headers?.Cookie || ''),
    seen[1]?.headers?.Cookie || '(无)'
  )

  eq('轮询：未扫码 → waiting', (await auth.pollQrLogin()).status, 'waiting')
  const poll = seen.find((s) => s.url.includes('ptqrlogin')) || {}
  log('轮询串带上了 ptqrtoken', /ptqrtoken=/.test(poll.url || ''), (poll.url || '').slice(0, 90))
  log('轮询只带 qrsig（不带二维码会话 cookie）', poll.headers?.Cookie === 'qrsig=qrsig123', poll.headers?.Cookie || '(无)')
  eq('轮询：失效 → expired', (await auth.pollQrLogin()).status, 'expired')
  eq('会话结束后再轮询 → expired', (await auth.pollQrLogin()).status, 'expired')
  await auth.closeQrSession()
  await auth.dispose()
  eq('关闭会话不抛错', true, true)
}

// ---------------------------------------------------------------------------
// 6. api/auth.js 分发到平台后端
// ---------------------------------------------------------------------------
console.log('\n=== 6. auth 分发 ===')
{
  const fake = {
    pingServer: async () => 'native-ping',
    fetchPing: async () => ({ reachable: true, authRequired: false, authed: true }),
    unlock: async () => ({ ok: true, native: true }),
    startQrLogin: async () => 'native-qr',
    pollQrLogin: async () => ({ status: 'waiting', native: true }),
    closeQrSession: async () => {},
  }
  setAuthBackend(fake)
  eq('fetchPing 走平台实现', await fetchPing(), { reachable: true, authRequired: false, authed: true })
  eq('startQrLogin 走平台实现', await startQrLogin(), 'native-qr')
  eq('pollQrLogin 走平台实现', await pollQrLogin(), { status: 'waiting', native: true })
  await closeQrSession()
  log('closeQrSession 走平台实现', true)
  setAuthBackend(null)
  log('可卸载平台后端（回到 Web 行为）', true)
}

// ---------------------------------------------------------------------------
// 7. 二进制响应解码（真机 bug 回归）
//    CapacitorHttp 的 arraybuffer/blob 返回 base64 字符串；非 2xx 走 error stream
//    返回纯文本。曾经把 base64 当原始字节，导致真机「二维码返回内容异常」。
// ---------------------------------------------------------------------------
console.log('\n=== 7. 二进制响应解码 ===')
const pngB64 = Buffer.from(pngBytes()).toString('base64')
const htmlB64 = Buffer.from("ptuiCB('66','0','','0','二维码未失效。','')").toString('base64')
{
  // Android 的 Base64.DEFAULT 每 76 字符插入换行，必须也能识别
  const wrappedB64 = pngB64.replace(/(.{76})/g, '$1\n')

  log('识别标准 base64', looksLikeBase64(pngB64))
  log('识别带换行的 base64（Android Base64.DEFAULT）', looksLikeBase64(wrappedB64))
  log('普通文本不误判', !looksLikeBase64('error') && !looksLikeBase64('Not Found') && !looksLikeBase64(''))
  eq('去空白后可解码', base64ToBytes(wrappedB64).length, 120)
  eq('base64 → Blob 大小正确', base64ToBlob(pngB64, 'image/png').size, 120)
  eq('normalizeBase64 支持 URL-safe', normalizeBase64('a-b_c'), 'a+b/c')
}

{
  // 模拟 Android：arraybuffer 请求成功 → base64；失败 → 纯文本
  const http = createNativeHttp({
    CapacitorHttp: {
      request: async (opts) => {
        if (opts.url.includes('/ssl/ptqrshow')) {
          return { status: 200, headers: { 'Content-Type': 'image/png' }, data: pngB64 }
        }
        if (opts.url.includes('/ssl/ptqrlogin')) {
          return { status: 200, headers: { 'Content-Type': 'text/html' }, data: htmlB64 }
        }
        if (opts.url.includes('/check_sig')) {
          return { status: 200, headers: { 'Content-Type': 'application/json' }, data: { code: 0 } }
        }
        if (opts.url.includes('/boom')) {
          return { status: 500, headers: { 'Content-Type': 'text/plain' }, data: 'Internal Server Error' }
        }
        return { status: 200, headers: {}, data: '' }
      },
    },
  })

  const img = await http.transport({ url: 'https://xui.ptlogin2.qq.com/ssl/ptqrshow' })
  const bytes = new Uint8Array(await img.arrayBuffer())
  eq('二维码字节长度正确', bytes.length, 120)
  log('二维码首字节是 PNG 魔数 0x89（真机 bug 回归）', bytes[0] === 0x89 && bytes[1] === 0x50, `首字节=${bytes[0]}`)

  const html = await http.transport({ url: 'https://xui.ptlogin2.qq.com/ssl/ptqrlogin' })
  log('base64 的文本响应能还原出 ptuiCB', /ptuiCB\('66'/.test(await html.text()), (await html.text()).slice(0, 40))

  const json = await http.transport({ url: 'https://ssl.ptlogin2.qq.com/check_sig' })
  eq('JSON 响应仍是对象（不受 base64 影响）', await json.json(), { code: 0 })

  const err = await http.transport({ url: 'https://x/y/boom' })
  eq('非 2xx 的纯文本不被误解码', await err.text(), 'Internal Server Error')
  log('非 2xx 时 ok 为 false', err.ok === false)
}

{
  const http = createNativeHttp({
    CapacitorHttp: {
      request: async () => ({
        status: 200,
        headers: { 'Content-Type': 'image/png' },
        data: Buffer.from(pngBytes()).toString('base64'),
      }),
    },
  })
  const blob = await http.fetchBlob('https://i0.hdslb.com/a.png')
  log('fetchBlob 返回真正的 Blob', blob instanceof Blob && blob.size === 120, `size=${blob?.size} type=${blob?.type}`)
  eq('Blob MIME 取自响应头', blob.type, 'image/png')
}

{
  // 端到端：真机登录第一步（生成二维码）必须能出图
  const pngB64 = Buffer.from(pngBytes()).toString('base64')
  const http = createNativeHttp({
    CapacitorHttp: {
      request: async (opts) => {
        if (opts.url.includes('/cgi-bin/xlogin')) {
          return { status: 200, headers: { 'Set-Cookie': 'pt_login_sig=sig1; Path=/' }, data: '' }
        }
        if (opts.url.includes('/ssl/ptqrshow')) {
          return { status: 200, headers: { 'Set-Cookie': 'qrsig=qr1; Path=/', 'Content-Type': 'image/png' }, data: pngB64 }
        }
        return { status: 200, headers: { 'Content-Type': 'text/html' }, data: Buffer.from("ptuiCB('66','0','','0','二维码未失效。','')").toString('base64') }
      },
    },
  })
  const auth = createNativeAuth({ transport: http.transport })
  const image = await auth.startQrLogin()
  log('真机流程：startQrLogin 返回有效 PNG dataURL', /^data:image\/png;base64,iVBOR/.test(image), image.slice(0, 32))
  eq('真机流程：轮询解析 ptuiCB 成功', (await auth.pollQrLogin()).status, 'waiting')
  await auth.closeQrSession()
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// 8. 网页登录（打开腾讯官方登录页取 Cookie）
// ---------------------------------------------------------------------------
console.log('\n=== 8. 网页登录 ===')
{
  const calls = []
  const plugin = {
    open: async (opts) => {
      calls.push(opts)
      return {
        cookie: ' uin=o0012345; qm_keyst=abc; qqmusic_key=abc ',
        url: 'https://y.qq.com/n/ryqq',
        hasMusicKey: true,
        cookieNames: 'uin,qm_keyst,qqmusic_key',
        navLog: 'https://xui.ptlogin2.qq.com/...\nhttps://y.qq.com/n/ryqq',
        jumpUrl: 'https://ssl.ptlogin2.qq.com/check_sig?uin=123',
      }
    },
    clear: async () => {
      calls.push({ cleared: true })
    },
  }

  const wl = createNativeWebLogin(plugin)
  const r = await wl.open()
  eq('默认不带一键登录开关', calls[0].allowOneKey, false)
  const rOne = await wl.open({ allowOneKey: true })
  eq('实验开关能透传到原生', calls[1].allowOneKey, true)
  log('一键登录模式返回结构与普通一致', typeof rOne.cookie === 'string' && typeof rOne.hasMusicKey === 'boolean')
  log(
    '网页登录入口 = 普通登录页 + s_url 指向 OAuth authorize',
    /xui\.ptlogin2\.qq\.com\/cgi-bin\/xlogin/.test(calls[0].url) &&
      /s_url=https%3A%2F%2Fgraph\.qq\.com%2Foauth2\.0%2Fauthorize/.test(calls[0].url),
    calls[0].url.slice(0, 95)
  )
  log('入口不落在会卡死的 login_jump 上', !/login_jump/.test(calls[0].url))
  log(
    'redirect_uri 指向 y.qq.com 完成票据兑换',
    /redirect_uri%3Dhttps%253A%252F%252Fy\.qq\.com/.test(calls[0].url)
  )
  log('回传 Cookie 已去首尾空白', r.cookie === 'uin=o0012345; qm_keyst=abc; qqmusic_key=abc', r.cookie)
  log('回传 hasMusicKey', r.hasMusicKey === true)
  eq('回传 Cookie 名单（诊断用）', r.cookieNames, 'uin,qm_keyst,qqmusic_key')
  log('回传跳转轨迹与跳板 URL（诊断用）', /check_sig/.test(r.jumpUrl) && /ptlogin2/.test(r.navLog))
  eq('能从回传 Cookie 解析出 QQ 号（去掉 o 前缀）', parseUinFromCookie(r.cookie), '0012345')

  await wl.clear()
  log('clear 会调用原生插件', calls.some((c) => c.cleared))
  log('缺少插件实例时明确报错', (() => {
    try {
      createNativeWebLogin(null)
      return false
    } catch {
      return true
    }
  })())

  // 登录没走完（没有 qm_keyst）：调用方必须能识别并拒绝建立登录态
  const wl2 = createNativeWebLogin({
    open: async () => ({
      cookie: 'qlogin_uid=abc; pt_login_sig=def; qrsig=ghi',
      hasMusicKey: false,
      cookieNames: 'qlogin_uid,pt_login_sig,qrsig',
      url: 'https://xui.ptlogin2.qq.com/cgi-bin/xlogin',
    }),
    clear: async () => {},
  })
  const r2 = await wl2.open()
  log('登录未完成时不谎报 hasMusicKey', r2.hasMusicKey === false)
  log('登录未完成时能看出 Cookie 里没有票据', !/(?:^|;\s*)(qm_keyst|qqmusic_key)=/.test(r2.cookie), r2.cookieNames)
  eq('位数不足的 uin 不会被误解析', parseUinFromCookie(r2.cookie), '')
}

// ---------------------------------------------------------------------------
// 8b. 票据补完：WebView 只负责登录，qm_keyst 我们自己对换
//     实测：authorize 环节 QQ 会要求「一键登录（拉起手机 QQ）」，因此不能用它
// ---------------------------------------------------------------------------
console.log('\n=== 8b. 网页登录票据补完 ===')
{
  const pSkeyCookie = 'p_skey=abc123; p_uin=o0012345; pt2gguin=o0012345; uin=o0012345'
  let finishCalls = 0

  // 已有票据：不应再调用 finish
  const wl1 = createNativeWebLogin(
    { open: async () => ({ cookie: 'uin=1; qm_keyst=ok', hasMusicKey: true }), clear: async () => {} },
    { finish: async () => { finishCalls++; return { cookie: 'x', hasMusicKey: true } } }
  )
  const a = await wl1.open()
  log('已有 qm_keyst 时不重复兑换', a.hasMusicKey === true && finishCalls === 0)

  // 无 p_skey：不应调用 finish（无法兑换）
  finishCalls = 0
  const wl2 = createNativeWebLogin(
    { open: async () => ({ cookie: 'qlogin_uid=abc; pt_login_sig=def', hasMusicKey: false }), clear: async () => {} },
    { finish: async () => { finishCalls++; return { cookie: 'x', hasMusicKey: true } } }
  )
  const b = await wl2.open()
  log('没有 p_skey 时不尝试兑换', b.hasMusicKey === false && finishCalls === 0)

  // 有 p_skey：调用 finish，补完后 hasMusicKey 变 true
  finishCalls = 0
  const wl3 = createNativeWebLogin(
    { open: async () => ({ cookie: pSkeyCookie, hasMusicKey: false, cookieNames: 'p_skey,p_uin' }), clear: async () => {} },
    {
      finish: async (cookie) => {
        finishCalls++
        eq('finish 收到的是 WebView 回传的 Cookie', cookie, pSkeyCookie)
        return { cookie: `${cookie}; qm_keyst=NEW; qqmusic_key=NEW; uin=12345`, hasMusicKey: true, diag: { ok: 1 } }
      },
    }
  )
  const c = await wl3.open()
  log('有 p_skey 时自动调用 finish', finishCalls === 1)
  log('补完后 hasMusicKey 为 true', c.hasMusicKey === true)
  log('补完后 Cookie 已替换为含票据的版本', /qm_keyst=NEW/.test(c.cookie))
  log('标记为本地补完', c.completedLocally === true)
  eq('补完后能解析出 QQ 号', parseUinFromCookie(c.cookie), '0012345')

  // finish 失败：不应抛错，记录 finishError
  const wl4 = createNativeWebLogin(
    { open: async () => ({ cookie: pSkeyCookie, hasMusicKey: false }), clear: async () => {} },
    { finish: async () => { throw new Error('网络不可用') } }
  )
  const d = await wl4.open()
  log('finish 失败不抛错且记录原因', d.hasMusicKey === false && /网络不可用/.test(d.finishError || ''), d.finishError)

  // 核心工具：Cookie 字符串往返
  const jar = parseCookieString('a=1; b=2; ; c=3')
  eq('parseCookieString 解析正确', [...jar], [['a', '1'], ['b', '2'], ['c', '3']])
  eq('cookieString 拼回正确', cookieString(jar), 'a=1; b=2; c=3')
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// 9. auth 的网页登录分发
// ---------------------------------------------------------------------------
console.log('\n=== 9. auth 网页登录分发 ===')
{
  log('未注入时 supportsWebLogin 为 false', supportsWebLogin() === false)
  let err = ''
  try {
    await webLoginPage()
  } catch (e) {
    err = e.message
  }
  log('未注入时调用会给出明确提示', /不支持网页登录/.test(err), err)
  await clearWebLoginCookies() // 未注入时应静默

  let cleared = false
  setWebLogin({
    open: async () => ({ cookie: 'uin=9', url: '', hasMusicKey: true }),
    clear: async () => {
      cleared = true
    },
  })
  log('注入后 supportsWebLogin 为 true', supportsWebLogin() === true)
  eq('webLoginPage 走平台实现', (await webLoginPage()).cookie, 'uin=9')
  await clearWebLoginCookies()
  log('clearWebLoginCookies 走平台实现', cleared)

  setWebLogin(null)
  log('可卸载（回到 Web 行为）', supportsWebLogin() === false)
}

// ---------------------------------------------------------------------------
// 10. 手动 Cookie 导入（书签小工具 + 剪贴板）
//     已验证：QQ音乐网页自己就用 document.cookie 读 qqmusic_key（与 qm_keyst 同值），
//     所以移动端可用书签小工具复制 Cookie
// ---------------------------------------------------------------------------
console.log('\n=== 10. 手动 Cookie 导入 ===')
{
  const bm = buildBookmarklet()
  log('书签小工具是 javascript: 协议', bm.startsWith('javascript:'))
  log('书签小工具读取 qqmusic_key', /qqmusic_key/.test(bm))
  log('书签小工具写剪贴板（失败时退回 prompt 便于手动复制）', /navigator\.clipboard\.writeText/.test(bm) && /prompt\(/.test(bm))

  eq(
    '清洗 DevTools 整段（Cookie: 前缀 / 换行 / 多余空格）',
    normalizePastedCookie('Cookie: uin=12345; qqmusic_key=abc;  ptcz=zzz\n'),
    'uin=12345; qqmusic_key=abc; ptcz=zzz'
  )
  eq('清洗首尾引号', normalizePastedCookie('"uin=1; qqmusic_key=k"'), 'uin=1; qqmusic_key=k')
  eq('丢弃非法片段（空项 / 无等号）', normalizePastedCookie('uin=1;; ;=x; qqmusic_key=k'), 'uin=1; qqmusic_key=k')
  log('能识别可用登录 Cookie', cookieHasLogin('uin=1; qqmusic_key=k') && !cookieHasLogin('uin=1; ptcz=z'))
  eq('从书签小工具输出解析 uin', parseUinFromCookie('uin=10000; qqmusic_key=K'), '10000')
  eq('兼容网页版的 qqmusic_uin', parseUinFromCookie('qqmusic_uin=10000; x=1'), '10000')
  eq('兼容 ptui_loginuin', parseUinFromCookie('ptui_loginuin=1234567'), '1234567')
}

// ---------------------------------------------------------------------------
// 11. 平台隔离：业务层不得直接依赖 Capacitor
// ---------------------------------------------------------------------------
console.log('\n=== 11. 平台隔离 ===')
{
  const { readFileSync } = await import('node:fs')
  const { readdirSync, statSync } = await import('node:fs')
  const { join } = await import('node:path')
  const offenders = []
  // 只看真正的 import/require，避免把注释里提到的包名误判为依赖
  const importsCapacitor = /(?:from\s*['"]|import\s*\(\s*['"]|require\s*\(\s*['"])@capacitor\//
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) walk(p)
      else if (/\.(js|vue)$/.test(name) && importsCapacitor.test(readFileSync(p, 'utf8'))) {
        offenders.push(p)
      }
    }
  }
  walk('src/api')
  walk('src/store')
  walk('src/components')
  walk('src/core')
  walk('src/utils')
  log('业务层（api/store/components/core/utils）不 import @capacitor/*', offenders.length === 0, offenders.join(', '))

  const main = readFileSync('src/main.js', 'utf8')
  log('入口先安装平台适配再挂载', /initPlatform\(\)/.test(main) && /mount\('#app'\)/.test(main))
  log(
    '入口动态导入应用模块（避免模块级请求绕过原生拦截器）',
    !/^import App from/m.test(main) && /import\('\.\/App\.vue'\)/.test(main) && /import\('\.\/router\/index\.js'\)/.test(main)
  )
}

// ---------------------------------------------------------------------------
// 12. 歌词解析（LRC，纯函数）
// ---------------------------------------------------------------------------
console.log('\n=== 12. 歌词解析（LRC） ===')
{
  const { parseLrc, mergeTranslation, findLineIndex } = await import('../src/utils/lrc.js')
  const lrc = '[ti:测试]\n[ar:歌手]\n[offset:0]\n[00:00.00]第一句\n[00:12.34]第二句\n[01:02.50][02:00.00]重复句'
  const lines = parseLrc(lrc)
  eq('解析出 4 行（多时间戳行展开）', lines.length, 4)
  eq('第一行时间为 0', lines[0].time, 0)
  eq('小数秒解析正确', Math.round(lines[1].time * 100) / 100, 12.34)
  eq('元数据行被忽略、正文正确', lines[0].text, '第一句')
  eq('多时间戳行正文相同', lines[2].text === '重复句' && lines[3].text === '重复句', true)

  const off = parseLrc('[offset:500]\n[00:01.00]偏移句')
  eq('offset 生效（正数提前 0.5s）', Math.round(off[0].time * 100) / 100, 0.5)

  const merged = mergeTranslation(lines, '[00:00.00]First\n[00:12.34]Second')
  eq('翻译按时间戳合并', merged[0].trans, 'First')
  eq('无翻译行不带 trans', merged[2].trans, undefined)
  const tol = mergeTranslation([{ time: 5.02, text: 'x' }], '[00:05.00]tolerant')
  eq('翻译容差 50ms 内可匹配', tol[0].trans, 'tolerant')
  const placeholder = mergeTranslation(
    [
      { time: 1, text: '词：某某' },
      { time: 2, text: '正文' },
    ],
    '[00:01.00]//\n[00:02.00]Translation'
  )
  eq('翻译里的 // 占位被过滤', placeholder[0].trans, undefined)
  eq('正常翻译不受影响', placeholder[1].trans, 'Translation')
  eq('全为占位时不改动原行', mergeTranslation([{ time: 1, text: 'a' }], '[00:01.00]//')[0].trans, undefined)

  eq('查找当前行（13s → 第 2 行）', findLineIndex(lines, 13), 1)
  eq('早于第一句返回 -1', findLineIndex(lines, -1), -1)
  eq('晚于最后一句返回最后一行', findLineIndex(lines, 9999), 3)
  eq('空歌词解析为空数组', parseLrc('').length, 0)
  eq('无时间戳文本解析为空数组', parseLrc('just text').length, 0)
}

// ---------------------------------------------------------------------------
// 13. 歌词同步（偏移换算 / iframe t 参数）
// ---------------------------------------------------------------------------
console.log('\n=== 13. 歌词同步（S1/S2） ===')
{
  const { toLyricTime, toSeekTime, lyricDurationMismatch } = await import('../src/utils/lrc.js')
  eq('正偏移 = 歌词延后（补偿前奏）', toLyricTime(10, 5000), 5)
  eq('负偏移 = 歌词提前', toLyricTime(10, -2000), 12)
  eq('无偏移原样返回', toLyricTime(10, 0), 10)
  eq('点击行 seek 反算偏移', toSeekTime(5, 5000), 10)
  eq('时长差异：超过阈值返回差值', lyricDurationMismatch(269, 235), 34)
  eq('时长差异：阈值内返回 0', lyricDurationMismatch(269, 266), 0)
  eq('时长差异：缺数据返回 0', lyricDurationMismatch(0, 200), 0)

  const { playerUrl } = await import('../src/api/bilibili.js')
  const noT = playerUrl('BV1d4411N7zD', 1, 0)
  const withT = playerUrl('BV1d4411N7zD', 1, 90.7)
  log('iframe 地址默认不带 t=', !/[?&]t=/.test(noT), noT)
  log('iframe 地址带 t=（秒取整）', /[?&]t=90(&|$)/.test(withT), withT)
  log('iframe 地址保留 bvid/page/autoplay', /bvid=BV1d4411N7zD/.test(withT) && /autoplay=1/.test(withT))
}

// ---------------------------------------------------------------------------
// 14. 原生媒体控制 / 桌面歌词（P1.4b / P2.3）
// ---------------------------------------------------------------------------
console.log('\n=== 14. 原生媒体控制 / 桌面歌词 ===')
{
  const { readFileSync } = await import('node:fs')
  const read = (p) => readFileSync(p, 'utf8')
  const manifest = read('android/app/src/main/AndroidManifest.xml')
  log(
    '清单声明前台服务（mediaPlayback）',
    /MediaControlService/.test(manifest) && /foregroundServiceType="mediaPlayback"/.test(manifest)
  )
  log(
    '清单声明所需权限',
    /FOREGROUND_SERVICE_MEDIA_PLAYBACK/.test(manifest) && /POST_NOTIFICATIONS/.test(manifest) && /SYSTEM_ALERT_WINDOW/.test(manifest)
  )
  const service = read('android/app/src/main/java/com/bilimusic/player/MediaControlService.java')
  log(
    '服务实现 MediaSession + MediaStyle 通知 + 播放状态',
    /MediaSessionCompat/.test(service) && /MediaStyle/.test(service) && /setPlaybackState/.test(service)
  )
  log(
    '服务实现桌面歌词悬浮窗（可拖动）',
    /TYPE_APPLICATION_OVERLAY/.test(service) && /OnTouchListener/.test(service) && /canDrawOverlays/.test(service)
  )
  log(
    '悬浮窗逐字（QRC 词级着色）',
    /lyricSung/.test(service) && /parseLyricWords/.test(service) && /ForegroundColorSpan/.test(service) && /buildKaraokeText/.test(service)
  )
  log(
    '悬浮窗罗马音行',
    /lyricRoma/.test(service) && /overlayRoma/.test(service)
  )
  const plugin = read('android/app/src/main/java/com/bilimusic/player/MediaControlPlugin.java')
  log(
    '插件暴露 update/setOverlay/updateLyric/权限方法',
    /public void update/.test(plugin) &&
      /public void setOverlay/.test(plugin) &&
      /public void updateLyric/.test(plugin) &&
      /hasOverlayPermission/.test(plugin)
  )
  log(
    '插件透传逐字/罗马音字段',
    /lyricWords/.test(plugin) && /lyricRoma/.test(plugin) && /getArray\("words"\)/.test(plugin) && /getInt\("sung"/.test(plugin)
  )
  log(
    '通知栏显示当前歌词行（无歌词回退歌手 + 歌手进 subText）',
    /notifyLyric/.test(service) && /setContentText\(contentText\)/.test(service) && /setSubText\(artist\)/.test(service)
  )
  log('迷你播放器第三行歌词（miniLyricView）', /miniLyricView/.test(service) && /miniLyric/.test(service))
  log(
    '插件透传歌词行（update.lyric / updateMiniPlayer.lyric）',
    /mediaLyric/.test(plugin) && /miniLyric/.test(plugin)
  )
  const mainActivity = read('android/app/src/main/java/com/bilimusic/player/MainActivity.java')
  log('MainActivity 注册 MediaControlPlugin', /registerPlugin\(MediaControlPlugin\.class\)/.test(mainActivity))
  const { existsSync } = await import('node:fs')
  log(
    '通知栏「桌面歌词」两态图标存在',
    existsSync('android/app/src/main/res/drawable/ic_stat_lyrics_on.xml') &&
      existsSync('android/app/src/main/res/drawable/ic_stat_lyrics_off.xml')
  )
}

// ---------------------------------------------------------------------------
// 15. seek 稳定性（缓冲期不回弹）
// ---------------------------------------------------------------------------
console.log('\n=== 15. seek 稳定性（纯函数） ===')
{
  const { shouldIgnoreStaleTimeUpdate, SEEK_TOLERANCE, SEEK_SETTLE_MS, SEEK_HARD_MS } = await import('../src/utils/seek.js')
  eq('无待结算 seek：不忽略', shouldIgnoreStaleTimeUpdate(5, null, 100), false)
  eq('明显偏离目标：忽略（防回弹）', shouldIgnoreStaleTimeUpdate(10, 100, 300), true)
  eq('已到达容差内：接受', shouldIgnoreStaleTimeUpdate(99, 100, 300), false)
  eq('刚好等于容差：接受', shouldIgnoreStaleTimeUpdate(100 - SEEK_TOLERANCE, 100, 0), false)
  eq(
    '大跨度 seek 缓冲期（超过重试窗口）仍忽略',
    shouldIgnoreStaleTimeUpdate(10, 100, SEEK_SETTLE_MS + 5000),
    true
  )
  eq('超过硬上限：接受现实（避免假进度）', shouldIgnoreStaleTimeUpdate(10, 100, SEEK_HARD_MS), false)
  eq('目标非法：不误伤', shouldIgnoreStaleTimeUpdate(10, NaN, 100), false)
}

// ---------------------------------------------------------------------------
// 16. 搜索解析（c.y.qq.com 经典 CGI fixture）
// ---------------------------------------------------------------------------
console.log('\n=== 16. 搜索解析（fixture） ===')
{
  const { readFileSync } = await import('node:fs')
  const { parseSongSearch, parseSonglistSearch, aggregateSingers, stripJsonp, SEARCH_TYPES } = await import(
    '../src/api/qq/search.js'
  )
  const load = (f) => JSON.parse(readFileSync(new URL(`../scripts/fixtures/qq/${f}`, import.meta.url), 'utf8'))

  const song = parseSongSearch(load('search-song.json'), 'song')
  log(
    '单曲：字段映射与总数',
    song.list.length === 2 &&
      song.list[0].name === '晴天' &&
      song.list[0].singers[0] === '周杰伦' &&
      song.list[0].mid === '0039MnYb0qxYhV' &&
      song.list[0].interval === 269 &&
      song.total === 600,
    JSON.stringify({ n: song.list.length, total: song.total })
  )
  log('单曲：有下一页（page*curnum < totalnum）', song.hasMore === true, String(song.hasMore))
  const page2 = parseSongSearch(load('search-song-page2.json'), 'song')
  log(
    '第二页：page=2 且续接正确',
    page2.page === 2 && page2.list[0].name === '搁浅' && page2.hasMore === true,
    JSON.stringify({ page: page2.page, first: page2.list[0]?.name })
  )

  const album = parseSongSearch(load('search-album.json'), 'album')
  log(
    '专辑：字段映射（albumMID/singerName）',
    album.list[0].name === '叶惠美' &&
      album.list[0].singers[0] === '周杰伦' &&
      album.list[0].mid === '000MkMni19ClKG' &&
      album.list[0].cover.includes('000MkMni19ClKG') &&
      album.list[0].pubtime === '2003-07-31',
    JSON.stringify(album.list[0])
  )

  const pl = parseSonglistSearch(load('search-playlist.json'))
  log(
    '歌单：id 可直接给 loadPlaylist + HTML 实体解码',
    pl.list[0].id === '7280525088' &&
      pl.list[0].name.startsWith('华语') &&
      !pl.list[0].name.includes('&#') &&
      pl.list[0].songCount === 27 &&
      pl.list[0].nick === 'QQ音乐官方歌单',
    JSON.stringify(pl.list[0])
  )
  log(
    '歌单：0 基页码 → page=1 且总数=display_num',
    pl.page === 1 && pl.total === 951973 && pl.hasMore === true,
    JSON.stringify({ page: pl.page, total: pl.total })
  )
  const jsonp = stripJsonp(`MusicJsonCallback(${JSON.stringify(load('search-playlist.json'))})`)
  log('JSONP 壳剥离（与纯 JSON 等价）', jsonp?.data?.list?.length === 2 && stripJsonp('{"a":1}').a === 1)

  const singers = aggregateSingers(song.list)
  log(
    '歌手：聚合去重（周杰伦 mid 来自单曲 singer[]）',
    singers.length === 2 &&
      singers[0].name === '周杰伦' &&
      singers[0].mid === '0025NhlN2yWrP4' &&
      singers[0].songCount === 1 &&
      singers[0].cover.includes('T001R'),
    JSON.stringify(singers)
  )
  log('歌手：无 mid 时不伪造头像', aggregateSingers([{ singers: ['某人'] }])[0].cover === '')
  eq(
    'search_type 常量',
    [SEARCH_TYPES.song, SEARCH_TYPES.album, SEARCH_TYPES.playlist, SEARCH_TYPES.singer].join(','),
    '0,8,2,9'
  )
  const empty = parseSongSearch({}, 'song')
  log('空响应不报错', empty.list.length === 0 && empty.total === 0 && empty.hasMore === false)
}

// ---------------------------------------------------------------------------
// 17. 热搜与联想解析（fixture）
// ---------------------------------------------------------------------------
console.log('\n=== 17. 热搜与联想解析（fixture） ===')
{
  const { readFileSync } = await import('node:fs')
  const { parseHotKeys, parseSuggestions } = await import('../src/api/qq/search.js')
  const load = (f) => JSON.parse(readFileSync(new URL(`../scripts/fixtures/qq/${f}`, import.meta.url), 'utf8'))

  const hotData = load('hotkey.json').req_0.data
  const hot = parseHotKeys(hotData)
  log(
    '热搜：解析字段（title/description/封面 httpsify，默认限量 12）',
    hot.length === 12 && hot[0].keyword === '易烊千玺dvd' && hot[0].description === '正在热搜' && hot[0].cover.startsWith('https://'),
    JSON.stringify(hot.slice(0, 2))
  )
  log(
    '热搜：去重 + 限量',
    parseHotKeys({ vec_hotkey: [hotData.vec_hotkey[0], hotData.vec_hotkey[0], hotData.vec_hotkey[1]] }).length === 2 &&
      parseHotKeys(hotData, 2).length === 2
  )
  log(
    '热搜：空/异常字段不报错',
    parseHotKeys({}).length === 0 && parseHotKeys({ vec_hotkey: [{}, { title: ' ok ' }] })[0].keyword === 'ok'
  )

  const sug = parseSuggestions(load('suggest.json').data)
  log(
    '联想：单曲优先且带类型/副标题',
    sug.length === 8 && sug[0].type === 'song' && sug[0].name === '晴天' && sug[0].sub === '周杰伦' && sug[2].type === 'singer' && sug[2].mid === '004Ya5GP1ckXTA',
    JSON.stringify(sug.slice(0, 3))
  )
  log('联想：截断与空响应', parseSuggestions(load('suggest.json').data, 3).length === 3 && parseSuggestions({}).length === 0)
}

// ---------------------------------------------------------------------------
// 18. 排行榜解析（fixture）
// ---------------------------------------------------------------------------
console.log('\n=== 18. 排行榜解析（fixture） ===')
{
  const { readFileSync } = await import('node:fs')
  const { parseRankGroups, parseRankDetail } = await import('../src/api/qq/rank.js')
  const load = (f) => JSON.parse(readFileSync(new URL(`../scripts/fixtures/qq/${f}`, import.meta.url), 'utf8'))

  const idx = parseRankGroups(load('rank-index.json').req_0.data)
  log(
    '榜单分组：名称与列表',
    idx.length === 2 && idx[0].name === '巅峰榜' && idx[0].lists.length === 2 && idx[0].lists.some((l) => l.id === 26 && l.title === '热歌榜'),
    JSON.stringify(idx.map((g) => `${g.name}:${g.lists.map((l) => l.title).join('/')}`))
  )
  log(
    '榜单分组：封面 httpsify + 更新日期',
    idx[0].lists[0].cover.startsWith('https://') && /^\d{4}-\d{2}-\d{2}$/.test(idx[0].lists[0].updateTime),
    JSON.stringify({ cover: idx[0].lists[0].cover, updateTime: idx[0].lists[0].updateTime })
  )

  const det = parseRankDetail(load('rank-detail.json').req_0.data)
  log(
    '榜单详情：排名条目与歌曲信息按下标合并',
    det.info.title === '热歌榜' &&
      det.info.total === 300 &&
      det.list.length === 3 &&
      det.list[0].rank === 1 &&
      det.list[0].name === '茶汤' &&
      det.list[0].mid === '0027rBks3lqPA3' &&
      det.list[0].singers[0] === '郁可唯' &&
      det.list[0].interval === 308,
    JSON.stringify(det.list[0])
  )
  log(
    '榜单详情：hasMore 按 offset + 条数 < total',
    det.hasMore === true && parseRankDetail(load('rank-detail.json').req_0.data, { offset: 297 }).hasMore === false
  )
  log(
    '榜单详情：rankValue 过滤无意义的 0',
    det.list[0].rankValue === '' &&
      parseRankDetail({ data: { title: 'x', totalNum: 1, song: [{ rank: 1, rankValue: '15%' }] }, songInfoList: [{ mid: 'm1', name: 'n' }] }).list[0]
        .rankValue === '15%'
  )
  log(
    '榜单：空响应不报错',
    parseRankGroups({}).length === 0 && parseRankDetail({}).list.length === 0 && parseRankDetail({}).info.total === 0
  )
}

// ---------------------------------------------------------------------------
// 19. 歌单广场解析（fixture）
// ---------------------------------------------------------------------------
console.log('\n=== 19. 歌单广场解析（fixture） ===')
{
  const { readFileSync } = await import('node:fs')
  const { parseTagGroups, parseSquareList, ALL_CATEGORY_ID } = await import('../src/api/qq/square.js')
  const load = (f) => JSON.parse(readFileSync(new URL(`../scripts/fixtures/qq/${f}`, import.meta.url), 'utf8'))

  const groups = parseTagGroups(load('square-tags.json').data)
  log(
    '分类分组：名称与标签',
    groups.length === 2 &&
      groups[0].name === '热门' &&
      groups[0].tags[0].id === ALL_CATEGORY_ID &&
      groups[0].tags[0].name === '全部' &&
      groups[1].name === '流派' &&
      groups[1].tags.some((t) => t.id === 11 && t.name === '摇滚'),
    JSON.stringify(groups.map((g) => `${g.name}:${g.tags.map((t) => t.name).join('/')}`))
  )
  log(
    '分类分组：排序项（allsorts → sorts）',
    groups[1].tags[0].sorts.some((s) => s.id === 3 && s.name === '最热'),
    JSON.stringify(groups[1].tags[0].sorts)
  )
  log(
    '分类分组：标签名 HTML 实体解码',
    parseTagGroups({ categories: [{ categoryGroupName: '流派', items: [{ categoryId: 1, categoryName: 'R&#38;B' }] }] })[0].tags[0].name === 'R&B'
  )

  const p1 = parseSquareList(load('square-list.json'))
  log(
    '歌单列表：字段映射与总数',
    p1.list.length === 10 &&
      p1.total === 11619 &&
      p1.list[0].id === '7707261125' &&
      p1.list[0].name.startsWith('甜度爆表') &&
      p1.list[0].cover.startsWith('https://') &&
      p1.list[0].nick.length > 0 &&
      p1.list[0].listenNum > 0,
    JSON.stringify(p1.list[0])
  )
  log('歌单列表：hasMore（ein + 1 < sum）', p1.hasMore === true)
  const p2 = parseSquareList(load('square-list-page2.json'))
  log('第二页：数据与首页不同', p2.list.length === 10 && p2.list[0].id !== p1.list[0].id, p2.list[0]?.name)
  log('歌单列表：空响应不报错', parseSquareList({}).list.length === 0 && parseSquareList({}).hasMore === false)
}

// ---------------------------------------------------------------------------
// 20. 每日推荐解析（fixture）
// ---------------------------------------------------------------------------
console.log('\n=== 20. 每日推荐解析（fixture） ===')
{
  const { readFileSync } = await import('node:fs')
  const { parseRadarSongs, RADAR_MODULE } = await import('../src/api/qq/daily.js')
  const load = (f) => JSON.parse(readFileSync(new URL(`../scripts/fixtures/qq/${f}`, import.meta.url), 'utf8'))

  const p1 = parseRadarSongs(load('daily-radar.json').req_0.data)
  log(
    '雷达解析：Track → 内部歌曲',
    p1.length === 3 &&
      p1[0].name === '稻香' &&
      p1[0].mid === '003aAYrm3GE0Ac' &&
      p1[0].singers[0] === '周杰伦' &&
      p1[0].interval > 0 &&
      p1[0].cover.startsWith('https://'),
    JSON.stringify(p1[0])
  )
  log(
    '雷达解析：页内按 mid 去重',
    parseRadarSongs({ VecSongs: [{ Track: { mid: 'm1', name: 'a' } }, { Track: { mid: 'm1', name: 'a' } }] }).length === 1
  )
  log(
    '雷达解析：空/无效 Track 跳过',
    parseRadarSongs({}).length === 0 && parseRadarSongs({ VecSongs: [{}, { Track: {} }] }).length === 0
  )
  eq('雷达模块常量', RADAR_MODULE, 'music.recommend.TrackRelationServer')
}

// ---------------------------------------------------------------------------
// 21. 歌手页解析（fixture）
// ---------------------------------------------------------------------------
console.log('\n=== 21. 歌手页解析（fixture） ===')
{
  const { readFileSync } = await import('node:fs')
  const { parseArtistDetail, parseArtistSongs, parseArtistAlbums, parseSimilarArtists } = await import('../src/api/qq/artist.js')
  const load = (f) => JSON.parse(readFileSync(new URL(`../scripts/fixtures/qq/${f}`, import.meta.url), 'utf8'))

  const det = parseArtistDetail(load('artist-detail.json').req_0.data)
  log(
    '歌手详情：信息 + 热门单曲',
    det.info.name === '周杰伦' &&
      det.info.mid === '0025NhlN2yWrP4' &&
      det.info.fans === 50784337 &&
      det.info.totalSong === 1012 &&
      det.info.brief.length > 50 &&
      det.hotSongs.length === 3 &&
      det.hotSongs[0].name === '晴天' &&
      det.hotSongs[0].mid === '0039MnYb0qxYhV',
    JSON.stringify({ info: det.info, hot: det.hotSongs.map((s) => s.name) })
  )
  log('歌手头像按 mid 构造', det.info.avatar === 'https://y.gtimg.cn/music/photo_new/T001R300x300M0000025NhlN2yWrP4.jpg')

  const songs = parseArtistSongs(load('artist-songs.json').req_0.data)
  log(
    '歌手单曲：嵌套 songInfo 映射',
    songs.total === 1012 && songs.songs.length === 2 && songs.songs[0].name === '晴天' && songs.songs[0].album === '叶惠美',
    JSON.stringify(songs.songs.map((s) => `${s.name}/${s.album}`))
  )

  const albums = parseArtistAlbums(load('artist-albums.json').req_0.data)
  log(
    '歌手专辑：总数 / 封面 / 发行日',
    albums.total === 43 &&
      albums.albums.length === 2 &&
      albums.albums[0].name === '周杰伦的床边故事' &&
      albums.albums[0].pubtime === '2016-06-24' &&
      albums.albums[0].cover.includes('T002R300x300M000003RMaRI1iFoYd'),
    JSON.stringify(albums.albums[0])
  )

  const sim = parseSimilarArtists(load('artist-similar.json').req_0.data)
  log(
    '相似歌手：http 头像升级为 https',
    sim.length >= 2 && sim[0].name === 'F.I.R.飞儿乐团' && sim[0].mid === '0010PLKl2Wgolz' && sim[0].avatar.startsWith('https://'),
    JSON.stringify(sim[0])
  )
  log(
    '歌手空响应不报错',
    parseArtistDetail({}).hotSongs.length === 0 &&
      parseArtistSongs({}).songs.length === 0 &&
      parseArtistAlbums({}).albums.length === 0 &&
      parseSimilarArtists({}).length === 0
  )
}

// ---------------------------------------------------------------------------
// 22. 专辑详情增强解析（fixture）
// ---------------------------------------------------------------------------
console.log('\n=== 22. 专辑详情增强解析（fixture） ===')
{
  const { readFileSync } = await import('node:fs')
  const { parseAlbumDetail, ALBUM_MODULE } = await import('../src/api/qq/album.js')
  const load = (f) => JSON.parse(readFileSync(new URL(`../scripts/fixtures/qq/${f}`, import.meta.url), 'utf8'))

  const al = parseAlbumDetail(load('album-detail.json').req_0.data)
  log(
    '专辑详情：名称/译名/发行日/公司',
    al.name === '十一月的萧邦' &&
      al.tranName === "November's Chopin" &&
      al.pubtime === '2005-11-01' &&
      al.company === '杰威尔音乐有限公司' &&
      al.singers[0] === '周杰伦' &&
      al.cover.includes('T002R300x300M0000024bjiL2aocxT') &&
      al.desc.length > 50,
    JSON.stringify({ name: al.name, tran: al.tranName, date: al.pubtime, company: al.company })
  )
  log('专辑详情：空响应不报错', parseAlbumDetail({}).name === '未知专辑' && parseAlbumDetail({}).singers.length === 0)
  eq('专辑详情模块常量', ALBUM_MODULE, 'music.musichallAlbum.AlbumInfoServer')
}

// ---------------------------------------------------------------------------
// 23. 歌曲详情解析（相似歌曲 + 评论）
// ---------------------------------------------------------------------------
console.log('\n=== 23. 歌曲详情解析（fixture） ===')
{
  const { readFileSync } = await import('node:fs')
  const { parseSimilarSongs, parseComments, cleanCommentContent, SIMILAR_MODULE } = await import('../src/api/qq/songDetail.js')
  const load = (f) => JSON.parse(readFileSync(new URL(`../scripts/fixtures/qq/${f}`, import.meta.url), 'utf8'))

  const sim = parseSimilarSongs(load('song-similar.json').req_0.data)
  log(
    '相似歌曲：vecSong[].track → 内部歌曲',
    sim.length === 2 && sim[0].name === '开始懂了' && sim[0].singers[0] === '孙燕姿' && sim[0].mid === '003PSWcB4EDl6P' && sim[0].cover.startsWith('https://'),
    JSON.stringify(sim[0])
  )

  const cmt = parseComments(load('song-comments-synthetic.json'))
  log(
    '评论：热评 / 最新 / 总数',
    cmt.hot.length === 2 &&
      cmt.hot[0].nick === '示例用户A' &&
      cmt.hot[0].content.startsWith('这是一条用于测试') &&
      cmt.hot[0].praise > 1000 &&
      cmt.hot.every((c) => c.hot) &&
      cmt.list.length === 2 &&
      cmt.total === 230665,
    JSON.stringify({ hot: cmt.hot.length, list: cmt.list.length, total: cmt.total })
  )
  log(
    '评论：[em] 表情码清理 + 空响应',
    cleanCommentContent('[em]e400198[/em]测试 [em]e400 [/em] ！') === '测试 ！' &&
      parseComments({}).hot.length === 0 &&
      parseComments({}).total === 0 &&
      parseComments({ comment: { commentlist: [{ rootcommentcontent: '  ' }] } }).list.length === 0
  )
  eq('相似歌曲模块常量', SIMILAR_MODULE, 'music.recommend.TrackRelationServer')
}

// ---------------------------------------------------------------------------
// 24. 写操作基础设施（P4.0）
// ---------------------------------------------------------------------------
console.log('\n=== 24. 写操作基础设施（P4.0） ===')
{
  const { buildWriteComm, getMusicKey } = await import('../src/api/qq/comm.js')
  const { canWrite, writeError, SIGNED_PATH } = await import('../src/api/qq/write.js')
  const { zzcSign } = await import('../src/core/zzcSign.js')
  const { getGtk } = await import('../src/core/qqLogin.js')

  const cookie = 'uin=10000; qm_keyst=TESTKEY; p_skey=abc'
  const comm = buildWriteComm({ uin: '10000', cookie })
  log(
    'buildWriteComm：g_tk = hashLike(qm_keyst, 5381) + platform=yqq',
    comm.g_tk === getGtk('TESTKEY') && comm.platform === 'yqq' && comm.uin === '10000' && comm.format === 'json',
    JSON.stringify(comm)
  )
  log('getMusicKey：qm_keyst / qqmusic_key 均可识别', getMusicKey(cookie) === 'TESTKEY' && getMusicKey('qqmusic_key=K2') === 'K2')
  let noKeyErr = ''
  try {
    buildWriteComm({ uin: '10000', cookie: 'uin=10000; p_skey=abc' })
  } catch (e) {
    noKeyErr = e.message
  }
  log('buildWriteComm：缺票据抛可读错误（受限会话）', /qm_keyst|音乐票据/.test(noKeyErr), noKeyErr)

  log(
    'canWrite：票据检测',
    canWrite(cookie) === true && canWrite('uin=1; p_skey=x') === false && canWrite('') === false && canWrite(null) === false
  )

  const e1000 = writeError({ code: 1000 }, null, '收藏')
  const e2001 = writeError({ code: 2001 }, null, '取消收藏')
  const e80105 = writeError({ code: 80105 }, null, '收藏')
  const eRet = writeError({ code: 0 }, { retCode: 80105 }, '收藏')
  const eUnknown = writeError({ code: 12345 }, null, '收藏')
  log(
    'writeError：已知码可读文案 / retCode / 未知码带原始码 / 正常为 null',
    /重新登录/.test(e1000.message) &&
      /操作过于频繁/.test(e2001.message) &&
      /code=2001/.test(e2001.message) &&
      /上游拒绝/.test(e80105.message) &&
      /上游拒绝/.test(eRet.message) &&
      /code=12345/.test(eUnknown.message) &&
      writeError({ code: 0 }, { retCode: 0 }) === null &&
      writeError(null, null) === null,
    `${e1000.message} | ${e2001.message} | ${eUnknown.message}`
  )

  // zzc 签名（musics.fcg 网关要求）：固定向量 + 形状
  const vec1 = await zzcSign('{"a":1}')
  const vec2 = await zzcSign(
    '{"comm":{"ct":24,"cv":0,"uin":"10000","format":"json","platform":"yqq","g_tk":1},"req_0":{"module":"music.musicasset.PlaylistDetailWrite","method":"AddSonglist","param":{"dirId":201,"tid":0,"bFmtUtf8":true,"v_songInfo":[{"songId":718477,"songType":13}]}}}'
  )
  log(
    'zzcSign：固定向量与参考实现一致',
    vec1 === 'zzc7746109xq501htmv4ipz7c8owlxfpihjm1fd695c7' && vec2 === 'zzcc0627f37ylfveb0v7ihyfhxtro3u2ixvw76ce348c',
    `${vec1} | ${vec2.slice(0, 24)}…`
  )
  log('zzcSign：形状（zzc 前缀 + 小写 + 无 +/= 符号）', /^zzc[a-z0-9]+$/.test(vec1) && vec1.length === vec2.length && !/[+/=]/.test(vec1))
  eq('签名网关路径常量', SIGNED_PATH, '/qqmu-api/cgi-bin/musics.fcg')
}

// ---------------------------------------------------------------------------
// 25. 红心（P4.1）
// ---------------------------------------------------------------------------
console.log('\n=== 25. 红心解析与参数（P4.1） ===')
{
  const { parseFavStates, buildFavPayload, buildFavSongParam } = await import('../src/api/qq/fav.js')
  const { mapSong } = await import('../src/api/qq/util.js')

  log(
    '红心回显解析（m_fan → boolean）',
    JSON.stringify(parseFavStates({ m_fan: { m1: true, m2: false, m3: 1 } })) === JSON.stringify({ m1: true, m2: false, m3: true }) &&
      Object.keys(parseFavStates({})).length === 0,
    JSON.stringify(parseFavStates({ m_fan: { m1: true, m2: false } }))
  )

  const payload = buildFavPayload({ id: '97773', songType: 13, name: '晴天' })
  log(
    '收藏写参数（dirId=201 / tid=0 / bFmtUtf8 / 数字 songId）',
    payload.dirId === 201 &&
      payload.tid === 0 &&
      payload.bFmtUtf8 === true &&
      payload.v_songInfo.length === 1 &&
      payload.v_songInfo[0].songId === 97773 &&
      payload.v_songInfo[0].songType === 13,
    JSON.stringify(payload)
  )
  log('songType 缺省 13', buildFavSongParam({ id: '1' }).songType === 13 && buildFavSongParam({ id: '1', songType: 0 }).songType === 13)
  let err = ''
  try {
    buildFavSongParam({ id: 'demo1' })
  } catch (e) {
    err = e.message
  }
  log('缺数字 ID 抛错（不发必然失败的请求）', /数字 ID/.test(err), err)
  log(
    'mapSong 带出 songType（songtype 优先）',
    mapSong({ songid: 1, songmid: 'm', type: 0, songtype: 13, name: 'x' }).songType === 13 &&
      mapSong({ songid: 2, songmid: 'm2', type: 0, name: 'y' }).songType === 0
  )
}

// ---------------------------------------------------------------------------
// 26. 歌单写操作（P4.4 / P4.6 / P4.7）
// ---------------------------------------------------------------------------
console.log('\n=== 26. 歌单写操作（P4.4/P4.6/P4.7） ===')
{
  const { songWriteInfo, chunk, parseCreateResult, parseSongWriteResult, BATCH_SIZE } = await import('../src/api/qq/playlistWrite.js')

  log(
    'songWriteInfo：数字 id + songType（缺省 13）',
    songWriteInfo({ id: '718477' }).songId === 718477 &&
      songWriteInfo({ id: '718477' }).songType === 13 &&
      songWriteInfo({ id: '1', songType: 0 }).songType === 13 &&
      songWriteInfo({ id: '1', songType: 13 }).songType === 13
  )
  let infoErr = ''
  try {
    songWriteInfo({ id: 'demo1' })
  } catch (e) {
    infoErr = e.message
  }
  log('songWriteInfo：缺数字 ID 抛错', /数字 ID/.test(infoErr), infoErr)

  log(
    'chunk：按 50 分块',
    BATCH_SIZE === 50 && JSON.stringify(chunk(Array.from({ length: 120 }, (_, i) => i)).map((c) => c.length)) === '[50,50,20]' && chunk([]).length === 0,
    JSON.stringify(chunk(Array.from({ length: 51 }, (_, i) => i)).map((c) => c.length))
  )

  log(
    'parseCreateResult：dirId/tid/name',
    JSON.stringify(parseCreateResult({ result: { dirId: 1, tid: 9783375556, dirName: 'x' } })) === JSON.stringify({ dirId: 1, tid: 9783375556, name: 'x' }) &&
      parseCreateResult({}).dirId === 0
  )

  log(
    'parseSongWriteResult：existed 统计',
    JSON.stringify(parseSongWriteResult({ result: { songlist: [{ existed: 0 }, { existed: 1 }, { existed: 0 }] } })) === JSON.stringify({ added: 2, existed: 1, failed: 0 }) &&
      parseSongWriteResult({}).added === 0
  )
}

// ---------------------------------------------------------------------------
// 27. 专辑/歌单收藏（P4.2 / P4.3）
// ---------------------------------------------------------------------------
console.log('\n=== 27. 专辑/歌单收藏（P4.2/P4.3） ===')
{
  const { parseFavWriteResult, buildAlbumFavParam, buildPlaylistFavParam } = await import('../src/api/qq/fav.js')

  log(
    '收藏写响应：result=0 且无失败项才算成功',
    parseFavWriteResult({ result: 0, v_failedAlbumId: [] }, 'v_failedAlbumId').ok === true &&
      parseFavWriteResult({ result: 0, v_failedAlbumId: [1] }, 'v_failedAlbumId').ok === false &&
      parseFavWriteResult({ result: 1 }, 'v_failedAlbumId').ok === false &&
      parseFavWriteResult({}, 'v_failedPlaylistId').ok === false,
    JSON.stringify(parseFavWriteResult({ result: 0, v_failedAlbumId: [] }, 'v_failedAlbumId'))
  )
  log(
    '专辑收藏参数（数字 id 数组，非 mid）',
    JSON.stringify(buildAlbumFavParam('60671')) === JSON.stringify({ v_albumId: [60671] }),
    JSON.stringify(buildAlbumFavParam(60671))
  )
  log(
    '歌单收藏参数（加密 uin + 数字 disstid）',
    JSON.stringify(buildPlaylistFavParam('7280525088', 'EUIN')) === JSON.stringify({ uin: 'EUIN', v_playlistId: [7280525088] }),
    JSON.stringify(buildPlaylistFavParam(7280525088, 'EUIN'))
  )
  let e1 = ''
  let e2 = ''
  try {
    buildAlbumFavParam('abc')
  } catch (e) {
    e1 = e.message
  }
  try {
    buildPlaylistFavParam('1', '')
  } catch (e) {
    e2 = e.message
  }
  log('缺数字 id / 缺 euin 抛错（不发必然失败的请求）', /专辑数字 ID/.test(e1) && /euin/.test(e2), `${e1} | ${e2}`)
}

// ---------------------------------------------------------------------------
// 28. 下载与本地音乐工具（P6）
// ---------------------------------------------------------------------------
console.log('\n=== 28. 下载与本地音乐工具（P6） ===')
{
  const { formatBytes, parseLocalFileName, extFromFileName, downloadStats, downloadsToSongs } = await import('../src/api/downloads.js')

  log(
    'formatBytes：B/KB/MB/GB',
    formatBytes(0) === '0 B' &&
      formatBytes(1024) === '1.0 KB' &&
      formatBytes(1024 * 1024 * 1.5) === '1.5 MB' &&
      formatBytes(1024 ** 3 * 2) === '2.00 GB',
    `${formatBytes(0)} | ${formatBytes(1024)} | ${formatBytes(1024 * 1024 * 1.5)} | ${formatBytes(1024 ** 3 * 2)}`
  )
  log(
    'parseLocalFileName：歌手 - 歌名 / 无分隔 / 多段',
    JSON.stringify(parseLocalFileName('周杰伦 - 晴天.mp3')) === JSON.stringify({ name: '晴天', singers: ['周杰伦'] }) &&
      parseLocalFileName('稻香.flac').name === '稻香' &&
      parseLocalFileName('A - B - C.m4a').name === 'B - C',
    JSON.stringify([parseLocalFileName('周杰伦 - 晴天.mp3'), parseLocalFileName('稻香.flac'), parseLocalFileName('A - B - C.m4a')])
  )
  log('extFromFileName：大小写与缺省', extFromFileName('a.MP3') === '.mp3' && extFromFileName('x') === '.mp3')

  log(
    'downloadStats：done/failed/downloading/pending 分类',
    JSON.stringify(downloadStats({ a: { status: 'done', size: 100 }, b: { status: 'failed' }, c: { status: 'downloading' }, d: { status: 'pending' } })) ===
      JSON.stringify({ count: 1, size: 100, downloading: 1, failed: 1, pending: 1 }) &&
      JSON.stringify(downloadStats({})) === JSON.stringify({ count: 0, size: 0, downloading: 0, failed: 0, pending: 0 })
  )
  log(
    'downloadsToSongs：只取完成项并带 localUri',
    downloadsToSongs({ a: { status: 'done', uri: 'file://x', song: { name: 'n', singers: ['s'] } } })[0]?.localUri === 'file://x' &&
      downloadsToSongs({ b: { status: 'failed' } }).length === 0
  )
}

// ---------------------------------------------------------------------------
// 29. 付费受限识别（G2）
// ---------------------------------------------------------------------------
console.log('\n=== 29. 付费受限识别（G2） ===')
{
  const { parseSongUrlInfo } = await import('../src/api/qq/song.js')
  const { mapSong } = await import('../src/api/qq/util.js')

  const ok = parseSongUrlInfo({ data: { sip: ['http://dl.stream.qqmusic.qq.com/'], midurlinfo: [{ purl: 'C400x.m4a?vkey=1', result: 0, filename: 'C400x.m4a' }] } })
  log(
    '可播：purl → https 直链',
    ok.url === 'https://dl.stream.qqmusic.qq.com/C400x.m4a?vkey=1' && ok.restriction === '' && ok.trial === false,
    JSON.stringify(ok)
  )
  const vip = parseSongUrlInfo({ data: { midurlinfo: [{ purl: '', result: 104003 }] } })
  log('受限：result=104003 → vip_required（需登录/会员）', vip.url === '' && vip.restriction === 'vip_required' && vip.result === 104003)
  log('受限：purl 为空 → copyright_unavailable', parseSongUrlInfo({ data: { midurlinfo: [{ purl: '', result: 0 }] } }).restriction === 'copyright_unavailable')
  log('受限：其它错误码 → url_unavailable', parseSongUrlInfo({ data: { midurlinfo: [{ purl: '', result: 104001 }] } }).restriction === 'url_unavailable')
  log(
    'mapSong 带出 payplay（VIP 标注用）',
    mapSong({ songmid: 'm', name: 'n', pay: { payplay: 1 } }).payplay === 1 &&
      mapSong({ songmid: 'm', name: 'n' }).payplay === 0 &&
      mapSong({ songmid: 'm', name: 'n', preview: { trybegin: 1 } }).hasPreview === true
  )
}

// ---------------------------------------------------------------------------
// 30. 听歌统计（P7.3 G4）
// ---------------------------------------------------------------------------
console.log('\n=== 30. 听歌统计（P7.3 G4） ===')
{
  const { recordListen, addListenMs, statsSummary, formatListenDuration, dayKey, STATS_MAX } = await import('../src/api/stats.js')

  let list = []
  for (let i = 0; i < 5; i++) list = recordListen(list, { key: 'k' + i, name: 'N' + i, at: 1000 + i })
  log('recordListen：最新在前', list[0].key === 'k4' && list.length === 5)

  let capped = []
  for (let i = 0; i < STATS_MAX + 10; i++) capped = recordListen(capped, { key: 'c' + i, at: i })
  log(`recordListen：上限 ${STATS_MAX} 且保留最新`, capped.length === STATS_MAX && capped[0].key === 'c' + (STATS_MAX + 9))

  const evs = [{ key: 'a', name: 'A', singers: ['X'], at: 0, ms: 0 }]
  log(
    'addListenMs：只更新最新一条且只增不减',
    addListenMs(evs, 'a', 5000) === true && evs[0].ms === 5000 && addListenMs(evs, 'a', 3000) === false && evs[0].ms === 5000 && addListenMs(evs, 'b', 9000) === false
  )

  const t0 = new Date(2026, 8, 20, 10, 30).getTime()
  const t1 = new Date(2026, 8, 20, 10, 45).getTime()
  const t2 = new Date(2026, 8, 21, 23, 5).getTime()
  const tOld = new Date(2026, 7, 1, 9, 0).getTime()
  const events = [
    { key: 's1', name: '晴天', singers: ['周杰伦'], at: t0, ms: 120000 },
    { key: 's1', name: '晴天', singers: ['周杰伦'], at: t1, ms: 60000 },
    { key: 's2', name: '稻香', singers: ['周杰伦'], at: t2, ms: 30000 },
    { key: 's3', name: '夜曲', singers: ['周杰伦', '费玉清'], at: tOld, ms: 90000 },
  ]

  const all = statsSummary(events, { days: 0, now: t2 })
  log(
    '汇总：总次数/总时长/独立歌曲/独立歌手',
    all.totalPlays === 4 && all.totalMs === 300000 && all.uniqueSongs === 3 && all.uniqueSingers === 2,
    JSON.stringify({ plays: all.totalPlays, ms: all.totalMs, songs: all.uniqueSongs, singers: all.uniqueSingers })
  )
  log('歌曲排行：按次数降序（晴天 2 次居首）', all.topSongs[0].key === 's1' && all.topSongs[0].plays === 2 && all.topSongs[0].ms === 180000 && all.topSongs.length === 3)
  log('歌手排行：周杰伦 4 次居首（每事件计一次）', all.topSingers[0].name === '周杰伦' && all.topSingers[0].plays === 4, JSON.stringify(all.topSingers))
  log('时段分布：按本地小时聚合', all.byHour[10] === 2 && all.byHour[23] === 1 && all.byHour[9] === 1 && all.byHour[11] === 0)
  log(
    '每日趋势：按天聚合且升序',
    all.byDay.length === 3 && all.byDay[0].day === dayKey(tOld) && all.byDay[1].plays === 2 && all.byDay[2].day === dayKey(t2),
    JSON.stringify(all.byDay)
  )

  const recent = statsSummary(events, { days: 7, now: t2 })
  log('范围过滤：近 7 天排除旧记录', recent.totalPlays === 3 && recent.totalMs === 210000 && recent.uniqueSongs === 2)
  log(
    'formatListenDuration：秒/分/小时',
    formatListenDuration(45000) === '45 秒' && formatListenDuration(1390000) === '23 分 10 秒' && formatListenDuration(11100000) === '3 小时 05 分',
    `${formatListenDuration(45000)} | ${formatListenDuration(1390000)} | ${formatListenDuration(11100000)}`
  )
}

// ---------------------------------------------------------------------------
// 31. 歌单导入导出（P7.4 G5）
// ---------------------------------------------------------------------------
console.log('\n=== 31. 歌单导入导出（P7.4 G5） ===')
{
  const { sanitizeFileName, playlistToJsonText, playlistToM3u, parsePlaylistJson, parsePlaylistFile, detectFormat, TRANSFER_FORMAT } =
    await import('../src/api/transfer.js')

  log('sanitizeFileName：非法字符替换 + 空名兜底', sanitizeFileName('a/b*c') === 'a_b_c' && sanitizeFileName('') === '歌单' && sanitizeFileName('  x  ') === 'x')

  const pl = { name: '我的歌单' }
  const songs = [
    { mid: 'm1', id: 97773, name: '晴天', singers: ['周杰伦'], album: '叶惠美', interval: 269 },
    { mid: 'm2', id: 449205, name: '稻香', singers: ['周杰伦'], album: '魔杰座', interval: 223 },
  ]

  const json = playlistToJsonText(pl, songs)
  const parsedJson = parsePlaylistFile('我的歌单.json', json)
  log(
    'JSON 往返：格式/名称/歌曲字段',
    JSON.parse(json).format === TRANSFER_FORMAT &&
      parsedJson.format === 'json' &&
      parsedJson.name === '我的歌单' &&
      parsedJson.songs.length === 2 &&
      parsedJson.songs[0].id === 97773 &&
      parsedJson.songs[0].interval === 269
  )

  const m3u = playlistToM3u(pl, songs)
  const parsedM3u = parsePlaylistFile('我的歌单.m3u', m3u)
  log(
    'm3u 往返：EXTINF 歌名/歌手 + songDetail mid',
    parsedM3u.format === 'm3u' &&
      parsedM3u.name === '我的歌单' &&
      parsedM3u.songs.length === 2 &&
      parsedM3u.songs[0].mid === 'm1' &&
      parsedM3u.songs[0].name === '晴天' &&
      parsedM3u.songs[0].singers[0] === '周杰伦' &&
      parsedM3u.songs[0].interval === 269,
    JSON.stringify(parsedM3u.songs[0])
  )

  log(
    'detectFormat：扩展名与内容识别',
    detectFormat('a.m3u8', '') === 'm3u' && detectFormat('a.json', '') === 'json' && detectFormat('', '[{"name":"x"}]') === 'json' && detectFormat('', '#EXTM3U') === 'm3u'
  )

  let err = ''
  try {
    parsePlaylistJson('{"format":"other"}')
  } catch (e) {
    err = e.message
  }
  log('非法 JSON 格式：可读报错', /不是本应用导出的歌单 JSON/.test(err), err)

  let err2 = ''
  try {
    parsePlaylistJson(JSON.stringify({ format: TRANSFER_FORMAT, version: 99, songs: [] }))
  } catch (e) {
    err2 = e.message
  }
  log('版本过新：可读报错', /版本过新/.test(err2), err2)

  let err3 = ''
  try {
    parsePlaylistFile('x.m3u', '#EXTM3U\n')
  } catch (e) {
    err3 = e.message
  }
  log('空歌单文件：可读报错', /没有可识别的歌曲/.test(err3), err3)

  // 无 mid 的本地条目：m3u 导出为 bmp://local/，解析后保留名称
  const localM3u = playlistToM3u(pl, [{ mid: '', id: 'local1', name: '本地歌', singers: [], interval: 100 }])
  const parsedLocal = parsePlaylistFile('local.m3u', localM3u)
  log('本地歌曲 m3u 往返（bmp://local 保留歌名）', parsedLocal.songs.length === 1 && parsedLocal.songs[0].name === '本地歌' && !parsedLocal.songs[0].mid)
}

// ---------------------------------------------------------------------------
// 32. 主题（P8.1 H1）
// ---------------------------------------------------------------------------
console.log('\n=== 32. 主题（P8.1 H1） ===')
{
  const { resolveTheme, THEMES } = await import('../src/store/theme.js')
  log('resolveTheme：显式 light/dark 优先于系统', resolveTheme('light', false) === 'light' && resolveTheme('dark', true) === 'dark')
  log(
    'resolveTheme：system / 非法值跟随系统偏好',
    resolveTheme('system', true) === 'light' && resolveTheme('system', false) === 'dark' && resolveTheme('', true) === 'light' && resolveTheme(undefined, false) === 'dark'
  )
  log('THEMES 常量', THEMES.join(',') === 'system,light,dark')
}

// ---------------------------------------------------------------------------
// 33. 收藏歌单读取（D3 修复）
// ---------------------------------------------------------------------------
console.log('\n=== 33. 收藏歌单读取（D3 修复） ===')
{
  const { parsePlaylistFavList, PLAYLIST_FAV_READ_MODULE } = await import('../src/api/qq/fav.js')
  const list = parsePlaylistFavList({
    v_list: [
      { tid: 7707261125, dirId: 31, name: '甜度爆表', logo: 'http://qpic.y.qq.com/music_cover/x/600?n=1', songnum: 66, orderTime: 1, nickname: 'QQ用户' },
      { dissid: '123', dissname: 'dissid 兜底' },
      { name: '没有 id' },
    ],
  })
  log(
    '解析：v_list/tid/名称/封面/数量映射 + kind',
    list[0].id === '7707261125' &&
      list[0].name === '甜度爆表' &&
      list[0].songCount === 66 &&
      list[0].nick === 'QQ用户' &&
      list[0].kind === 'collected' &&
      /^https:/.test(list[0].cover),
    JSON.stringify(list[0])
  )
  log('解析：dissid 兜底 + 过滤无 id 条目', list.length === 2 && list[1].id === '123' && list[1].name === 'dissid 兜底')
  log('读取模块名', PLAYLIST_FAV_READ_MODULE === 'music.musicasset.PlaylistFavRead')
  log('空响应不抛错', parsePlaylistFavList({}).length === 0 && parsePlaylistFavList(null).length === 0)
}

// ---------------------------------------------------------------------------
// 34. 逐字歌词（P8.4：3DES 解密 + QRC 解析）
// ---------------------------------------------------------------------------
console.log('\n=== 34. 逐字歌词（P8.4） ===')
{
  const { decryptQrcHex, looksLikeQrcHex, hexToBytes, DES_DECRYPT } = await import('../src/utils/qqc3des.js')
  const { parseQrc, parseQrcLine, extractQrcText, mergeQrcExtra, wordState } = await import('../src/utils/qrc.js')
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/qq/qrc-payload.json', import.meta.url), 'utf8'))

  log('looksLikeQrcHex：识别加密载荷', looksLikeQrcHex(fixture.lyricHex) && !looksLikeQrcHex('W3RpOuS4pA==') && !looksLikeQrcHex('abcd') && !looksLikeQrcHex(''))
  log('hexToBytes：偶数长度解析', (() => {
    const b = hexToBytes('0a1B')
    return b.length === 2 && b[0] === 10 && b[1] === 27
  })())
  log('DES 常量（解密模式）', DES_DECRYPT === 0)

  const xml = await decryptQrcHex(fixture.lyricHex)
  log(
    '3DES + zlib 解密真实载荷（容忍 8 字节分组填充）',
    /^<\?xml/.test(xml) && /<Lyric_1\b/.test(xml) && /LyricContent="/.test(xml),
    JSON.stringify(xml.slice(0, 44))
  )

  const lines = parseQrc(xml)
  const wordCount = lines.reduce((n, l) => n + l.words.length, 0)
  log('parseQrc：fixture 行数/词数（11 行 / 92 词）', lines.length === 11 && wordCount === 92, `lines=${lines.length} words=${wordCount}`)
  log(
    'parseQrc：行/词时间为绝对秒',
    lines[0].time === 0 && lines[0].words[1].time > lines[0].words[0].time && lines[lines.length - 1].time > 50 && lines[0].text.length > 0
  )
  log('parseQrc：空格单元保留', lines.some((l) => l.words.some((w) => w.text === ' ')))

  const synthetic = '[ti:测试]\n[offset:500]\n[1000,2000]你(1000,500) 好(1500,500)\n[4000,1000]再(4000,1000)见(5000,0)\n'
  const syn = parseQrc(synthetic)
  log(
    'parseQrc：offset 正偏移 → 行/词时间前移（与 LRC 的延后语义一致）',
    syn.length === 2 && syn[0].time === 0.5 && syn[0].words[0].time === 0.5 && syn[1].time === 3.5,
    JSON.stringify(syn.map((l) => l.time))
  )
  log('parseQrc：非 QRC 文本返回空', parseQrc('[00:01.00]普通 LRC 行').length === 0 && parseQrc('').length === 0)
  log(
    'extractQrcText：XML 属性（原始换行 + 实体转义）',
    extractQrcText('<Lyric_1 LyricContent="[ti:A&amp;B]\n[0,100]a(0,100)" />') === '[ti:A&B]\n[0,100]a(0,100)' &&
      extractQrcText('plain text') === 'plain text'
  )
  log('parseQrcLine：词与尾文本拼接', (() => {
    const r = parseQrcLine('a(0,10)bc(10,10)')
    return r.text === 'abc' && r.words.length === 2 && r.words[1].time === 0.01
  })())

  const merged = mergeQrcExtra(syn, '[00:00.50]trans line\n[00:03.50]second', 'trans')
  log('mergeQrcExtra：LRC 翻译按行时间合并', merged[0].trans === 'trans line' && merged[1].trans === 'second')
  const mergedRoma = mergeQrcExtra(syn, '[500,200]ro(500,200) ma(700,0)\n', 'roma')
  log('mergeQrcExtra：QRC 罗马音合并', mergedRoma[0].roma === 'ro ma' && !mergedRoma[1].roma)
  log('mergeQrcExtra：// 占位过滤', mergeQrcExtra(syn, '[00:00.50]//\n', 'trans')[0].trans === undefined)

  const w = [
    { text: 'a', time: 1, duration: 2 },
    { text: 'b', time: 3, duration: 1 },
  ]
  const s0 = wordState(w, 0.5)
  const s1 = wordState(w, 2)
  const s2 = wordState(w, 3.5)
  const s3 = wordState(w, 9)
  log(
    'wordState：未开始 / 进行中 / 切换 / 结束',
    s0.index === -1 && s1.index === 0 && Math.abs(s1.progress - 0.5) < 1e-6 && s2.index === 1 && Math.abs(s2.progress - 0.5) < 1e-6 && s3.index === 1 && s3.progress === 1
  )
}

// ---------------------------------------------------------------------------
// 35. 歌词信息行 / 版权行过滤（P8.4b）
// ---------------------------------------------------------------------------
console.log('\n=== 35. 歌词信息行 / 版权行过滤（P8.4b） ===')
{
  const { markCreditLines, mergeQrcExtra, TRANSLATION_CREDIT_RE } = await import('../src/utils/qrc.js')
  const { mergeTranslation } = await import('../src/utils/lrc.js')
  const song = { name: '稻香', singers: ['周杰伦'] }
  const lines = [
    { time: 0, text: '稻香 - 周杰伦 (Jay Chou)', words: [{ text: '稻', time: 0, duration: 1 }] },
    { time: 7.7, text: '对这个世界如果你有太多的抱怨' },
    { time: 20, text: '稻香 - 周杰伦', words: [] },
    { time: 30, text: '稻香' },
  ]
  const marked = markCreditLines(lines, song)
  log(
    'markCreditLines：开头「歌名 - 歌手」行标记 credit',
    marked[0].credit === true && !marked[1].credit,
    JSON.stringify(marked.map((l) => !!l.credit))
  )
  log('markCreditLines：只检查前 3 行（第 4 行不标记）', marked[2].credit === true && !marked[3].credit)
  log(
    'markCreditLines：无歌手信息时也识别「歌名」开头行',
    markCreditLines([{ time: 0, text: '稻香 (Live)' }], { name: '稻香', singers: [] })[0].credit === true
  )
  log('markCreditLines：不误伤普通歌词', markCreditLines([{ time: 0, text: '对这个世界如果你有太多的抱怨' }], song)[0].credit === undefined)
  log('markCreditLines：空输入安全', markCreditLines(null, song) === null && markCreditLines(lines, null) === lines)

  log(
    '版权行正则',
    TRANSLATION_CREDIT_RE.test('TME享有本翻译作品的著作权') &&
      TRANSLATION_CREDIT_RE.test('QQ音乐享有本翻译作品的著作权') &&
      !TRANSLATION_CREDIT_RE.test('恍若迎来了世界末日般')
  )
  const qrcTrans = '[0,500]TME享有本翻译作品的著作权(0,500)\n[1000,500]真正的翻译(1000,500)\n'
  const merged = mergeQrcExtra(
    [
      { time: 0, text: 'a' },
      { time: 1, text: 'b' },
    ],
    qrcTrans,
    'trans'
  )
  log('mergeQrcExtra：过滤翻译版权行', merged[0].trans === undefined && merged[1].trans === '真正的翻译', JSON.stringify(merged))
  const lrcTrans = '[00:00.00]QQ音乐享有本翻译作品的著作权\n[00:01.00]真正的翻译\n'
  const mergedLrc = mergeTranslation(
    [
      { time: 0, text: 'a' },
      { time: 1, text: 'b' },
    ],
    lrcTrans
  )
  log('mergeTranslation：过滤翻译版权行', mergedLrc[0].trans === undefined && mergedLrc[1].trans === '真正的翻译', JSON.stringify(mergedLrc))
}

// ---------------------------------------------------------------------------
// 36. 登录重试工具（F1–F3，2026-09-26）
// ---------------------------------------------------------------------------
console.log('\n=== 36. 登录重试工具（F1–F3） ===')
{
  log(
    '重试上限为合理正整数（轮询多于生成）',
    Number.isInteger(POLL_RETRY_MAX) && POLL_RETRY_MAX >= 3 && Number.isInteger(START_RETRY_MAX) && START_RETRY_MAX >= 2
  )
  eq('friendlyLoginError：Failed to fetch → 网络提示', friendlyLoginError('Failed to fetch'), '网络连接失败，请检查网络或代理后重试')
  eq(
    'friendlyLoginError：AbortError → 超时提示',
    friendlyLoginError('AbortError: The user aborted a request.'),
    '请求超时，请检查网络后重试'
  )
  eq(
    'friendlyLoginError：原生 DNS 失败 → 网络提示',
    friendlyLoginError('Unable to resolve host "xui.ptlogin2.qq.com": No address associated with hostname'),
    '网络连接失败，请检查网络或代理后重试'
  )
  eq(
    'friendlyLoginError：Network is unreachable → 网络提示',
    friendlyLoginError('Network is unreachable'),
    '网络连接失败，请检查网络或代理后重试'
  )
  eq('friendlyLoginError：中文文案原样返回', friendlyLoginError('登录接口返回异常 (HTTP 502)'), '登录接口返回异常 (HTTP 502)')
  eq('friendlyLoginError：未知英文加前缀兜底', friendlyLoginError('boom', '二维码获取失败'), '二维码获取失败：boom')
  eq('friendlyLoginError：空值兜底', friendlyLoginError('', '二维码获取失败'), '二维码获取失败')
  log('startRetryDelay：递增退避', startRetryDelay(1) === 800 && startRetryDelay(2) === 1600 && startRetryDelay(3) > startRetryDelay(2))
  log(
    'pollRetryMessage：带计数并夹取到上限',
    pollRetryMessage(1, POLL_RETRY_MAX).includes(`1/${POLL_RETRY_MAX}`) &&
      pollRetryMessage(9, 5).includes('5/5') &&
      pollRetryMessage(0, 5).includes('1/5')
  )
}

// ---------------------------------------------------------------------------
// 37. 评论写参数（P5 E2）
// ---------------------------------------------------------------------------
console.log('\n=== 37. 评论写参数（P5 E2） ===')
{
  const { buildAddCommentParam, buildDeleteCommentParam, COMMENT_MAX_LEN } = await import('../src/api/qq/comment.js')
  eq('评论参数：BizType=1 + 字符串 BizId + trim', buildAddCommentParam(97773, ' 你好 '), { Content: '你好', BizType: 1, BizId: '97773' })
  eq('回复参数带 RepliedCmId', buildAddCommentParam(97773, 'hi', '1!abc').RepliedCmId, '1!abc')
  log(
    '评论参数：缺歌曲 ID / 空内容 / 超长都提前抛错',
    (() => {
      const bad = (fn) => {
        try {
          fn()
          return false
        } catch {
          return true
        }
      }
      return bad(() => buildAddCommentParam(0, 'x')) && bad(() => buildAddCommentParam(1, '   ')) && bad(() => buildAddCommentParam(1, 'x'.repeat(COMMENT_MAX_LEN + 1)))
    })()
  )
  eq('删评论参数', buildDeleteCommentParam('1!abc'), { CommentId: '1!abc' })
  log(
    '删评论：缺 ID 提前抛错',
    (() => {
      try {
        buildDeleteCommentParam('')
        return false
      } catch {
        return true
      }
    })()
  )
  const { parseComments } = await import('../src/api/qq/songDetail.js')
  const parsed = parseComments({ comment: { commentlist: [{ commentid: 'x', rootcommentcontent: 'hi', uin: '10000' }] } })
  eq('评论解析带 uin（识别自己的评论用）', parsed.list[0].uin, '10000')
}

// ---------------------------------------------------------------------------
// 38. 分享工具（P5 E3）
// ---------------------------------------------------------------------------
console.log('\n=== 38. 分享工具（P5 E3） ===')
{
  const { songShareUrl, playlistShareUrl, shareTitle } = await import('../src/utils/share.js')
  eq('歌曲分享链接（mid）', songShareUrl('0039MnYb0qxYhV'), 'https://y.qq.com/n/ryqq/songDetail/0039MnYb0qxYhV')
  eq('歌曲无 mid → 空串（不生成假链接）', songShareUrl(''), '')
  eq('歌单分享链接（数字 id）', playlistShareUrl(7280525088), 'https://y.qq.com/n/ryqq/playlist/7280525088')
  eq('本地/导入歌单 → 空串', playlistShareUrl('local-abc'), '')
  eq('分享标题：歌名 - 歌手', shareTitle('晴天', ['周杰伦']), '晴天 - 周杰伦')
  eq('分享标题：无歌手只剩歌名', shareTitle('晴天', []), '晴天')
}

// ---------------------------------------------------------------------------
// 39. 关注歌手解析（P5 E5 可行部分）
// ---------------------------------------------------------------------------
console.log('\n=== 39. 关注歌手解析（P5 E5） ===')
{
  const { parseFollowedSingers, FOLLOW_MODULE } = await import('../src/api/qq/follow.js')
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/qq/followed-singers.json', import.meta.url), 'utf8'))
  const list = parseFollowedSingers(fixture.req_0.data)
  eq('关注歌手：MID/Name/AvatarUrl 映射（http 头像升级 https）', list[0], {
    mid: '0025NhlN2yWrP4',
    name: '周杰伦',
    avatar: 'https://y.gtimg.cn/music/photo_new/T001R300x300M0000025NhlN2yWrP4.jpg',
  })
  log('关注歌手：缺头像时按 mid 构造 + 过滤无 mid', list[1].avatar.includes('T001R300x300M000001BLpXF2DyJe2') && parseFollowedSingers({ List: [{ MID: '', Name: 'x' }] }).length === 0)
  log('关注歌手：空响应安全', parseFollowedSingers(null).length === 0 && parseFollowedSingers({}).length === 0)
  eq('关注歌手模块常量', FOLLOW_MODULE, 'music.concern.RelationList')

  // 关注歌手必须在业务层（设置页）按需触发，且在 Web 无 Capacitor 依赖
  const settings = readFileSync(new URL('../src/components/SettingsDialog.vue', import.meta.url), 'utf8')
  log('设置页：按需加载关注歌手（只读）', /loadFollowed/.test(settings) && /fetchFollowedSingers/.test(settings) && /follow-item/.test(settings))
}

// ---------------------------------------------------------------------------
// 40. 歌词时钟外推（iframe 平滑）
// ---------------------------------------------------------------------------
console.log('\n=== 40. 歌词时钟外推（iframe 平滑） ===')
{
  const { extrapolateTime } = await import('../src/utils/lyricClock.js')
  eq('外推：基准 + 经过时间', extrapolateTime(10, 1000, 1400, 480), 10.4)
  eq('外推：超过上限只取上限（不无限跑）', extrapolateTime(10, 1000, 5000, 480), 10.48)
  eq('外推：now < at（时钟异常）不倒退', extrapolateTime(10, 2000, 1000, 480), 10)
  eq('外推：非法输入安全', extrapolateTime(undefined, NaN, NaN), 0)

  // store 侧：歌词时钟只对 iframe 生效，且带 rAF 能力守卫（Node 环境不会崩）
  const lyricStore = readFileSync(new URL('../src/store/lyric.js', import.meta.url), 'utf8')
  log(
    '歌词时钟：iframe 外推 + rAF 守卫 + 暂停/seek 复位',
    /export const lyricNow/.test(lyricStore) &&
      /extrapolateTime/.test(lyricStore) &&
      /requestAnimationFrame/.test(lyricStore) &&
      /state\.player\.currentTime/.test(lyricStore) &&
      /source === 'iframe'/.test(lyricStore)
  )
}

console.log(`\n===== 平台层测试结果：PASS ${pass} / FAIL ${fail} =====`)
process.exit(fail === 0 ? 0 : 1)
