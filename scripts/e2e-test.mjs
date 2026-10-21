import md5 from 'blueimp-md5'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import {
  pickBest,
  rankCandidates,
  parseDuration,
  buildKeyword,
  scoreMatch,
  scoreDuration,
  isCandidate,
} from '../src/utils/match.js'
import { stripHtml } from '../src/api/bilibili.js'
import { parsePlaylistId, albumCover, parseUinFromCookie, isLikedDir, isLikedDirId } from '../src/api/qq.js'
import { loadFixture, createMockTransport, parseMusicuBody } from './lib/mock-transport.mjs'

// 目标地址可用 BMP_URL 覆盖；默认 5173。建议测试时用独立端口，避免影响正在开发的服务。
const B = process.env.BMP_URL || 'http://localhost:5173'
let pass = 0
let fail = 0
const log = (name, ok, extra = '') => {
  if (ok) pass++
  else fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  — ${extra}` : ''}`)
}
async function json(url, opts) {
  try {
    const r = await fetch(url, opts)
    let d = null
    try {
      d = await r.json()
    } catch {}
    return { status: r.status, d, headers: r.headers }
  } catch (e) {
    return { status: 0, error: e.message }
  }
}

/** 读取 QQ 音乐接口层全部源码（实现按域拆分在 src/api/qq/*，源码级守卫对整体生效） */
function readQqApiSource() {
  const barrel = readFileSync(new URL('../src/api/qq.js', import.meta.url), 'utf8')
  const dir = new URL('../src/api/qq/', import.meta.url)
  const files = readdirSync(dir).filter((f) => f.endsWith('.js'))
  return [barrel, ...files.map((f) => readFileSync(new URL(f, dir), 'utf8'))].join('\n')
}

/** 读取状态层全部源码（实现按域拆分在 src/store/*，源码级守卫对整体生效） */
function readStoreSource() {
  const dir = new URL('../src/store/', import.meta.url)
  const files = readdirSync(dir).filter((f) => f.endsWith('.js'))
  return files.map((f) => readFileSync(new URL(f, dir), 'utf8')).join('\n')
}

// ---------- 0. 访问口令守卫（仅当服务以 BMP_ACCESS_CODE 启动时执行） ----------
// 未解锁状态必须先测（此时不能带 Cookie），随后解锁并把 Cookie 附加到所有请求上。
console.log('\n=== 访问口令守卫 ===')
const ACCESS_CODE = process.env.BMP_ACCESS_CODE || ''
let AUTH_COOKIE = ''
if (!ACCESS_CODE) {
  console.log('SKIP  未设置 BMP_ACCESS_CODE（未开启强制口令），跳过')
} else {
  {
    const r = await json(`${B}/auth-api/ping`)
    log('ping 报告需要口令且未解锁', r.d?.authRequired === true && r.d?.authed === false, JSON.stringify(r.d))
  }
  {
    const guarded = [
      ['/qq-api/rsc/fcgi-bin/fcg_user_created_diss?hostuin=10000&size=1&format=json', 'GET'],
      ['/img-api?url=x', 'GET'],
      ['/media-api?url=x', 'GET'],
      ['/bili-api/x/web-interface/nav', 'GET'],
      ['/auth-api/qr/start', 'POST'],
    ]
    let blocked = 0
    for (const [p, m] of guarded) {
      const r = await fetch(`${B}${p}`, { method: m })
      if (r.status === 401) blocked++
    }
    log('未解锁时受保护接口全部 401', blocked === guarded.length, `${blocked}/${guarded.length}`)
  }
  {
    const r = await fetch(`${B}/`)
    log('静态资源放行（解锁页需要）', r.status === 200, `status=${r.status}`)
  }
  {
    const r = await fetch(`${B}/auth-api/unlock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'definitely-wrong' }),
    })
    log('错误口令被拒绝', r.status === 401, `status=${r.status}`)
  }
  {
    const r = await fetch(`${B}/auth-api/unlock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: ACCESS_CODE }),
    })
    const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : []
    AUTH_COOKIE = sc.map((c) => c.split(';')[0]).join('; ')
    log('正确口令通过并下发 Cookie', r.status === 200 && /bmp_access=/.test(AUTH_COOKIE), `status=${r.status}`)
    // 之后的请求全部自动带上访问 Cookie（若调用方自带 Cookie 则合并，不能覆盖）
    const orig = globalThis.fetch
    globalThis.fetch = (input, init = {}) => {
      const headers = { ...(init.headers || {}) }
      headers.Cookie = headers.Cookie ? `${AUTH_COOKIE}; ${headers.Cookie}` : AUTH_COOKIE
      return orig(input, { ...init, headers })
    }
  }
  {
    const r = await json(`${B}/qq-api/rsc/fcgi-bin/fcg_user_created_diss?hostuin=10000&size=1&format=json`)
    log('解锁后可访问受保护接口', r.status === 200 && r.d?.code === 0, `status=${r.status}`)
  }
  {
    const r = await json(`${B}/auth-api/ping`)
    log('解锁后 ping.authed=true', r.d?.authed === true, JSON.stringify(r.d))
  }
}

const TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41,
  13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34,
  44, 52,
]

// ---------- 1. 中间件 / 代理 ----------
console.log('\n=== 中间件 / 代理 ===')
{
  const r = await json(`${B}/auth-api/ping`)
  log('auth-api/ping', r.status === 200 && r.d?.ok === true, `status=${r.status}`)
}
let sidCookie = ''
{
  const r = await fetch(`${B}/auth-api/qr/start`, { method: 'POST' })
  const d = await r.json()
  const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : []
  sidCookie = sc.map((c) => c.split(';')[0]).join('; ')
  log('qr/start 返回二维码+会话Cookie', d.ok === true && String(d.image).startsWith('data:image/png;base64,') && !!sidCookie, `imgLen=${(d.image || '').length}`)
}
{
  const r = await json(`${B}/auth-api/qr/poll`)
  log('qr/poll 无会话→expired', r.d?.status === 'expired', JSON.stringify(r.d))
}
{
  const r = await json(`${B}/auth-api/qr/poll`, { headers: { Cookie: sidCookie } })
  log('qr/poll 有会话→waiting', r.d?.status === 'waiting', JSON.stringify(r.d))
}
{
  const r = await json(`${B}/auth-api/session/close`, { method: 'POST', headers: { Cookie: sidCookie } })
  log('session/close', r.d?.ok === true)
}
{
  const r = await fetch(`${B}/auth-api/nope`)
  log('未知 auth 路由→404', r.status === 404, `status=${r.status}`)
}
{
  const r = await fetch(`${B}/img-api`)
  log('img-api 缺 url→400', r.status === 400, `status=${r.status}`)
}
{
  const r = await fetch(`${B}/img-api?url=not-a-url`)
  log('img-api 非法 url→400', r.status === 400, `status=${r.status}`)
}
{
  const r = await fetch(`${B}/img-api?url=${encodeURIComponent('https://evil.example.com/a.jpg')}`)
  log('img-api 非白名单域→403', r.status === 403, `status=${r.status}`)
}
{
  const r = await fetch(`${B}/img-api?url=${encodeURIComponent('https://i0.hdslb.com/bfs/archive/b72e06e408b1636bb9ca8df55a171e44d6ba1702.jpg')}`)
  const b = await r.arrayBuffer()
  log('img-api 代理B站图→200 image', r.status === 200 && (r.headers.get('content-type') || '').startsWith('image/'), `${r.headers.get('content-type')} ${b.byteLength}B`)
}
{
  const r = await json(`${B}/qq-api/rsc/fcgi-bin/fcg_user_created_diss?hostuin=10000&size=5&handlet=2&format=json&inCharset=utf8&outCharset=utf-8&notice=0&platform=yqq.json&needNewCode=1`)
  log('qq-api 代理', r.d?.code === 0, `code=${r.d?.code}`)
}
{
  const r = await json(`${B}/qqmu-api/cgi-bin/musicu.fcg`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ comm: { ct: 24, cv: 0 }, req_0: { module: 'vkey.GetVkeyServer', method: 'CgiGetVkey', param: { guid: '1', songmid: ['001'], songtype: [0], uin: '0', loginflag: 1, platform: '20' } } }),
  })
  log('qqmu-api 代理可达', r.d && typeof r.d.code !== 'undefined', `code=${r.d?.code}`)
}
{
  const r = await json(`${B}/bili-api/x/web-interface/nav`)
  log('bili-api 代理', r.d?.code === -101, `code=${r.d?.code}`)
}

// ---------- 2. B站 WBI 搜索 + 并发 ----------
console.log('\n=== B站 WBI 搜索 ===')
async function biliSearch(keyword) {
  const nav = await (await fetch(`${B}/bili-api/x/web-interface/nav`)).json()
  const img = nav.data.wbi_img.img_url.split('/').pop().split('.')[0]
  const sub = nav.data.wbi_img.sub_url.split('/').pop().split('.')[0]
  const mixin = TAB.map((i) => (img + sub)[i]).join('').slice(0, 32)
  const wts = Math.round(Date.now() / 1000)
  const p = { search_type: 'video', keyword, page: 1, wts }
  const qs = Object.keys(p)
    .sort()
    .map((k) => `${k}=${encodeURIComponent(String(p[k]).replace(/[!'()*]/g, ''))}`)
    .join('&')
  const sign = md5(qs + mixin)
  const r = await (await fetch(`${B}/bili-api/x/web-interface/wbi/search/type?${qs}&w_rid=${sign}`)).json()
  return r
}
{
  try {
    const r = await biliSearch('晴天 周杰伦')
    log('WBI 搜索返回结果', r.code === 0 && (r.data?.result || []).some((v) => v.type === 'video'), `code=${r.code} n=${(r.data?.result || []).length}`)
  } catch (e) {
    // 上游抖动（空响应/超时）不应让整个测试脚本崩溃
    log('WBI 搜索返回结果', false, `请求异常：${e.message}`)
  }
}
{
  try {
    const arr = await Promise.all([biliSearch('A'), biliSearch('B'), biliSearch('C')])
    const ok = arr.every((r) => r.code === 0)
    log('WBI 并发3路均成功', ok, arr.map((r) => r.code).join(','))
  } catch (e) {
    log('WBI 并发3路均成功', false, `请求异常：${e.message}`)
  }
}

// ---------- 3. 纯逻辑（匹配/时长/实体） ----------
console.log('\n=== 匹配逻辑 ===')
{
  log('parseDuration("4:15")=255', parseDuration('4:15') === 255, String(parseDuration('4:15')))
  log('parseDuration("1:02:30")=3750', parseDuration('1:02:30') === 3750, String(parseDuration('1:02:30')))
}
{
  const song = { name: "I'm the One Who's Always Saved", singers: ['横山克'], interval: 142 }
  const videos = [
    { bvid: 'BV1', title: "【动漫原声-水果篮子】横山克-I'm the One Who's Always Saved", author: 'x', play: 15000, duration: '2:24' },
    { bvid: 'BV2', title: '无关视频 随便', author: 'y', play: 999999, duration: '2:20' },
  ]
  const best = pickBest(videos, song)
  log('撇号歌名能匹配', best?.bvid === 'BV1', `picked=${best?.bvid}`)
}
{
  const song = { name: '晴天', singers: ['周杰伦'], interval: 269 }
  const a = { bvid: 'A', title: '周杰伦 晴天', author: '', play: 1000, duration: '4:29' }
  const b = { bvid: 'B', title: '周杰伦 晴天', author: '', play: 1000, duration: '1:09' }
  const ranked = rankCandidates([b, a], song)
  log('时长接近者排前', ranked[0].bvid === 'A', ranked.map((v) => v.bvid).join('>'))
  log('scoreDuration 接近>偏差', scoreDuration(a, song) > scoreDuration(b, song))
}
{
  const song = { name: 'zzz不存在zzz', singers: ['xxxx'], interval: 100 }
  const v = { bvid: 'X', title: 'Hi-Res 无损 热门歌曲', author: '', play: 9999999, duration: '1:40' }
  log('完全不相关→null', pickBest([v], song) === null)
}
{
  const song = { name: '夜に藍', singers: ['月詠み'], interval: 200 }
  const list = [{ bvid: 'OK', title: '月詠み 夜に藍', author: '', play: 100, duration: '3:20' }]
  log('scoreMatch 命中歌名+歌手', scoreMatch(list[0], song) >= 80, String(scoreMatch(list[0], song)))
  log('buildKeyword', buildKeyword(song) === '夜に藍 月詠み', buildKeyword(song))
}

// ---------- 5. 更多边界 ----------
console.log('\n=== 更多边界 ===')
{
  const r0 = await fetch(`${B}/auth-api/qr/start`, { method: 'POST' })
  const ck = (r0.headers.getSetCookie ? r0.headers.getSetCookie() : []).map((c) => c.split(';')[0]).join('; ')
  await fetch(`${B}/auth-api/session/close`, { method: 'POST', headers: { Cookie: ck } })
  const r = await json(`${B}/auth-api/qr/poll`, { headers: { Cookie: ck } })
  log('关闭会话后 poll→expired', r.d?.status === 'expired', JSON.stringify(r.d))
}
{
  const rs = await Promise.all(Array.from({ length: 10 }, () => json(`${B}/auth-api/ping`)))
  log('10 路并发 ping 全部成功', rs.every((r) => r.d?.ok === true))
}
{
  const r = await fetch(`${B}/auth-api/qr/start`)
  log('GET qr/start→404', r.status === 404, `status=${r.status}`)
}
{
  const r = await fetch(`${B}/img-api?url=${encodeURIComponent('https://i0.hdslb.com/bfs/archive/definitely-not-exist-xyz123.jpg')}`)
  log('img-api 上游 404 透传', r.status === 404, `status=${r.status}`)
}
// 音频流代理（拖动进度的基础）
{
  const miss = await fetch(`${B}/media-api`)
  log('media-api 缺 url→400', miss.status === 400, `status=${miss.status}`)
  const bad = await fetch(`${B}/media-api?url=${encodeURIComponent('https://evil.example.com/a.mp3')}`)
  log('media-api 非白名单→403', bad.status === 403, `status=${bad.status}`)
  let audioUrl = ''
  try {
    const ck = 'buvid3=' + ((await (await fetch(`${B}/bili-api/x/frontend/finger/spi`)).json()).data?.b_3 || '')
    const pl = await (await fetch(`${B}/bili-api/x/player/pagelist?bvid=BV1d4411N7zD`, { headers: { 'X-Bili-Cookie': ck } })).json()
    const cid = pl?.data?.[0]?.cid
    const nav = await (await fetch(`${B}/bili-api/x/web-interface/nav`)).json()
    const k1 = nav.data.wbi_img.img_url.split('/').pop().split('.')[0]
    const k2 = nav.data.wbi_img.sub_url.split('/').pop().split('.')[0]
    const mixin = TAB.map((i) => (k1 + k2)[i]).join('').slice(0, 32)
    const wts = Math.round(Date.now() / 1000)
    const p = { bvid: 'BV1d4411N7zD', cid, fnval: 16, fnver: 0, fourk: 1, wts }
    const qs = Object.keys(p).sort().map((k) => `${k}=${encodeURIComponent(String(p[k]).replace(/[!'()*]/g, ''))}`).join('&')
    const pr = await (await fetch(`${B}/bili-api/x/player/wbi/playurl?${qs}&w_rid=${md5(qs + mixin)}`, { headers: { 'X-Bili-Cookie': ck } })).json()
    audioUrl = [...(pr?.data?.dash?.audio || [])].sort((a, b) => b.bandwidth - a.bandwidth)[0]?.baseUrl || ''
  } catch {
    audioUrl = ''
  }
  if (audioUrl) {
    const pr = `/media-api?url=${encodeURIComponent(audioUrl)}`
    const full = await fetch(`${B}${pr}`)
    log('media-api 代理音频→200', full.status === 200 && Number(full.headers.get('content-length')) > 0, `${full.status} ${full.headers.get('content-length')}B`)
    const rng = await fetch(`${B}${pr}`, { headers: { Range: 'bytes=0-4095' } })
    log('media-api 支持 Range→206', rng.status === 206 && /bytes 0-4095\//.test(rng.headers.get('content-range') || ''), `${rng.status} ${rng.headers.get('content-range')}`)
  } else {
    log('media-api 代理音频→200', false, '取不到音频流地址（可能被限流）')
    log('media-api 支持 Range→206', false, '跳过')
  }
}
{
  log('实体解码 &#x27;', stripHtml('I&#x27;m the One') === "I'm the One", stripHtml('I&#x27;m the One'))
  log('实体解码 &#39;/&amp;/&lt;', stripHtml('A&amp;B &#39;q&#39; &lt;t&gt;') === "A&B 'q' <t>", stripHtml('A&amp;B &#39;q&#39; &lt;t&gt;'))
  log('实体解码十进制 &#34;', stripHtml('say &#34;hi&#34;') === 'say "hi"', stripHtml('say &#34;hi&#34;'))
  log('去除 <em> 标签', stripHtml('<em>晴天</em>') === '晴天')
}
{
  log('isCandidate 30s 保留', isCandidate({ duration: '0:30' }) === true)
  log('isCandidate 10s 过滤', isCandidate({ duration: '0:10' }) === false)
  log('isCandidate 25min 过滤', isCandidate({ duration: '25:00' }) === false)
}
{
  log('parsePlaylistId 纯数字', parsePlaylistId('7011264340') === '7011264340')
  log('parsePlaylistId 链接', parsePlaylistId('https://y.qq.com/n/ryqq/playlist/7011264340') === '7011264340')
  log('parsePlaylistId ?id=', parsePlaylistId('https://y.qq.com/taoge.html?id=123456') === '123456')
  log('albumCover 形状', /^https:\/\/y\.gtimg\.cn\/music\/photo_new\/T002R300x300M000abc\.jpg$/.test(albumCover('abc', 300)), albumCover('abc', 300))
}
{
  // 「我喜欢」(201) 会混在「创建的歌单」里返回；侧栏「我的音乐」已单独展示 → 必须排除
  log('isLikedDir: dirid=201 判定为「我喜欢」', isLikedDir({ dirid: 201, diss_name: '我喜欢' }) === true)
  log('isLikedDir: tid=201 判定为「我喜欢」', isLikedDir({ tid: 201 }) === true)
  log('isLikedDir: QZone(tid=0,dirid=205) 不算', isLikedDir({ tid: 0, dirid: 205 }) === false)
  log('isLikedDir: 普通歌单不算', isLikedDir({ tid: 7011264340, dirid: 3, diss_name: '我的歌单' }) === false)
  log(
    'isLikedDirId: 映射后的歌单(dirId)也能判',
    isLikedDirId('7011264340', '201') === true && isLikedDirId('7011264340', 3) === false
  )
}
{
  // 登录 Cookie 里不一定有 uin=，受限会话只有 p_uin / pt2gguin / superuin（带 o 前缀）
  log('parseUin 常规 uin=', parseUinFromCookie('uin=10000; a=b') === '10000')
  log('parseUin p_uin 带 o 前缀', parseUinFromCookie('pt2gguin=o1234; p_uin=o10000; x=y') === '10000')
  log('parseUin superuin', parseUinFromCookie('superuin=o987654321; z=1') === '987654321')
  log('parseUin 无 uin 字段返回空', parseUinFromCookie('qm_keyst=abc; skey=def') === '')
  log('parseUin 空 Cookie 返回空', parseUinFromCookie('') === '')
  log('parseUin 不误判 ptnick_', parseUinFromCookie('ptnick_10000=xx; uin=888888') === '888888')
}

// ---------- 4. 源码级回归守卫 ----------
console.log('\n=== 源码回归守卫 ===')
{
  const src = readQqApiSource()
  // postMusicu 内部会 JSON.stringify，调用处不能再序列化一次（否则 body 被二次编码 → 接口返回空）
  log('qq.js: postMusicu 调用处未二次序列化', !/postMusicu\(\s*JSON\.stringify/.test(src))
  const i = src.indexOf('async function fetchLikedPage')
  const block = i >= 0 ? src.slice(i, i + 1200) : ''
  log('fetchLikedPage 传对象给 postMusicu', /const payload = \{/.test(block) && /postMusicu\(payload/.test(block))
  log('fetchLikedPage 使用 dirid:201', /dirid:\s*201/.test(block))
  log('qq.js:「创建的歌单」过滤掉「我喜欢」', /\.filter\(\(d\) => !isLikedDir\(d\)\)/.test(src))
  log('qq.js: 原始统计含被排除的「我喜欢」条数', /likedExcluded/.test(src))
}
{
  const storeSrc = readStoreSource()
  log(
    'store 已导入 fetchSongUrl（否则直链播放静默失效）',
    /import\s*\{[^}]*\bfetchSongUrl\b[^}]*\}\s*from\s*'\.\.\/api\/qq\.js'/.test(storeSrc)
  )
  log('store 已导入 isLikedDirId', /import\s*\{[^}]*\bisLikedDirId\b[^}]*\}\s*from\s*'\.\.\/api\/qq\.js'/.test(storeSrc))
  log('store: 侧栏「创建的歌单」排除「我喜欢」', /p\.kind !== 'collected' && !isLikedDirId/.test(storeSrc))
  log('store: 缓存恢复时也排除「我喜欢」', /d\.playlists\.filter\(\(p\) => !isLikedDirId/.test(storeSrc))
  log('store: 队列随歌单加载自动重建', /setQueueFromSongs\(songs\)/.test(storeSrc) && /setQueueFromSongs\(state\.songs\)/.test(storeSrc))
  log('store: 队列持久化键 bmp:queue', /bmp:queue/.test(storeSrc))
  {
    const audioStart = storeSrc.indexOf('function playAudioSource')
    const audioBlock = audioStart >= 0 ? storeSrc.slice(audioStart, audioStart + 900) : ''
    const iframeStart = storeSrc.indexOf('async function playViaBiliIframe')
    const iframeBlock = iframeStart >= 0 ? storeSrc.slice(iframeStart, iframeStart + 3000) : ''
    log(
      'store: 历史记录挂在音源真正播放处（音频 + 内嵌）',
      /recordHistory\(song\)/.test(audioBlock) && /recordHistory\(song\)/.test(iframeBlock)
    )
  }
  log(
    'store: 本地队列播放不改主列表',
    /export async function playLocalQueue/.test(storeSrc) &&
      /playLocalQueue[\s\S]{0,400}startPlayback\(songs\[index\], -1, seq\)/.test(storeSrc)
  )
  log(
    'store: 睡眠定时到点暂停',
    /export function setSleepTimer/.test(storeSrc) &&
      /export function cancelSleepTimer/.test(storeSrc) &&
      /sleepTicker[\s\S]{0,700}pause\(\)/.test(storeSrc)
  )
  log(
    'store: 全屏播放器展开同时认队列位置（重启恢复队列也能打开）',
    /export function expandPlayer[\s\S]{0,200}queueIndex >= 0/.test(storeSrc)
  )
  {
    const msSrc = readFileSync(new URL('../src/store/mediaSession.js', import.meta.url), 'utf8')
    log(
      '媒体控制：特性检测 + 关键动作齐全',
      /'mediaSession' in navigator/.test(msSrc) &&
        /setHandler\('play'/.test(msSrc) &&
        /setHandler\('pause'/.test(msSrc) &&
        /setHandler\('previoustrack'/.test(msSrc) &&
        /setHandler\('nexttrack'/.test(msSrc) &&
        /setHandler\('seekto'/.test(msSrc) &&
        /setHandler\('seekbackward'/.test(msSrc) &&
        /setHandler\('seekforward'/.test(msSrc)
    )
    log(
      '媒体控制：元数据（标题 / 歌手 / 封面）与播放状态',
      /new MediaMetadata/.test(msSrc) && /artwork/.test(msSrc) && /playbackState/.test(msSrc) && /setPositionState/.test(msSrc)
    )
  }
  {
    const lyricSrc = readFileSync(new URL('../src/store/lyric.js', import.meta.url), 'utf8')
    const qqApi = readQqApiSource()
    log(
      'store: 歌词自动跟随当前曲 + 缓存键',
      /export async function loadLyric/.test(lyricSrc) && /watch\(/.test(lyricSrc) && /bmp:lyric4:/.test(lyricSrc) && /parseQrc/.test(lyricSrc)
    )
    log(
      'api: 歌词接口（musicu trans:1 + 老接口回退）',
      /export async function fetchLyric/.test(qqApi) &&
        /music\.musichallSong\.PlayLyricInfo/.test(qqApi) &&
        /trans: 1/.test(qqApi) &&
        /fcg_query_lyric_new/.test(qqApi) &&
        /decodeBase64Utf8/.test(qqApi)
    )
    log(
      'store: 歌词校准偏移持久化 + 夹取',
      /export function setLyricOffset/.test(lyricSrc) && /LYRIC_OFFSET_MAX/.test(lyricSrc) && /LS\.lyricOffset/.test(lyricSrc)
    )
    const playerSrc = readFileSync(new URL('../src/store/player.js', import.meta.url), 'utf8')
    log(
      'store: 帧级插值（rAF + smoothTime）',
      /requestAnimationFrame/.test(playerSrc) && /smoothTime/.test(playerSrc) && /SMOOTH_MAX_EXTRAPOLATE_MS/.test(playerSrc)
    )
    log(
      'store: seek 结算（缓冲期保持目标 + 重试 + seeked 收尾）',
      /seekTarget/.test(playerSrc) &&
        /seekRetried/.test(playerSrc) &&
        /shouldIgnoreStaleTimeUpdate/.test(playerSrc) &&
        /SEEK_SETTLE_MS/.test(playerSrc) &&
        /audioEl\.seeking/.test(playerSrc) &&
        /addEventListener\('seeked'/.test(playerSrc) &&
        /tickBase = t/.test(playerSrc)
    )
    {
      const barSrc = readFileSync(new URL('../src/components/PlayerBar.vue', import.meta.url), 'utf8')
      const npSrc = readFileSync(new URL('../src/components/NowPlaying.vue', import.meta.url), 'utf8')
      log(
        '播放条：拖动只预览、松手才 seek',
        /dragRatio/.test(barSrc) && /seekRatio\(dragRatio\.value\)/.test(barSrc) && /displayRatio \* 100/.test(barSrc)
      )
      log(
        '全屏播放器：拖动只预览、松手才 seek',
        /dragRatio/.test(npSrc) && /seekRatio\(dragRatio\.value\)/.test(npSrc) && /displayRatio \* 100/.test(npSrc)
      )
    }
  log(
    'store: iframe 源带 t= 重载（seek / 恢复）',
    /reloadIframeAt/.test(playerSrc) &&
      /playerUrl\(match\.bvid, 1, state\.player\.currentTime\)/.test(playerSrc) &&
      /startAt: state\.player\.currentTime \|\| 0/.test(playerSrc)
  )
  {
    // 原生媒体控制（P1.4b）+ 桌面歌词（P2.3）
    const nativeIndex = readFileSync(new URL('../src/platform/native/index.js', import.meta.url), 'utf8')
    const mediaSession = readFileSync(new URL('../src/store/mediaSession.js', import.meta.url), 'utf8')
    const desktopLyric = readFileSync(new URL('../src/store/desktopLyric.js', import.meta.url), 'utf8')
    log('原生层注入媒体控制后端', /setMediaControlBackend/.test(nativeIndex) && /createNativeMediaControl/.test(nativeIndex))
    log(
      '媒体控制：原生分支（动作回传 + 状态推送）',
      /initNativeMediaControl/.test(mediaSession) && /mediaControlOnAction/.test(mediaSession) && /mediaControlUpdate/.test(mediaSession)
    )
    log(
      '媒体控制：seek 后立即推送（否则系统面板回弹）',
      /seekSeq/.test(mediaSession) && /seekSeq/.test(readFileSync(new URL('../src/store/player.js', import.meta.url), 'utf8'))
    )
    log(
      '桌面歌词：开关持久化 + 行/逐字/罗马音推送',
      /export async function toggleDesktopLyric/.test(desktopLyric) &&
        /bmp:desktop-lyric/.test(desktopLyric) &&
        /mediaControlUpdateLyric/.test(desktopLyric) &&
        /currentLyricLine/.test(desktopLyric) &&
        /wordState/.test(desktopLyric) &&
        /lyricRoma|config\.lyricRoma/.test(desktopLyric)
    )
    const settings = readFileSync(new URL('../src/components/SettingsDialog.vue', import.meta.url), 'utf8')
    const np = readFileSync(new URL('../src/components/NowPlaying.vue', import.meta.url), 'utf8')
    log(
      'Web 隐藏桌面歌词入口（v-if nativeMedia）',
      /v-if="nativeMedia"/.test(settings) && /v-if="nativeMedia[^"]*"/.test(np) && /hasMediaControl\(\)/.test(np)
    )
    log(
      '歌词校准：长按连续 + 时长差异提示',
      /startNudge/.test(np) && /pointerdown\.prevent="startNudge/.test(np) && /lyricDurationMismatch/.test(np)
    )
    log(
      '桌面歌词开关：显示器图标 + 两态标题（tooltip 说明）',
      /desktop-lyric-btn/.test(np) &&
        /桌面歌词（系统悬浮窗，退出 App 后显示）/.test(np) &&
        /name="desktopLyric"/.test(np) &&
        /name="floatLyric"/.test(np) &&
        /state\.desktopLyric\.enabled/.test(np)
    )
    {
      const css = readFileSync(new URL('../src/styles/main.css', import.meta.url), 'utf8')
      const mobileBlock = css.slice(css.indexOf('移动端播放条：保留队列入口'))
      log(
        '移动端播放条保留队列入口（仅隐藏其它右侧元素）',
        /\.player-right\s*{\s*display:\s*flex/.test(mobileBlock) && /\.player-right \.sleep-wrap/.test(mobileBlock)
      )
    }
    const service = readFileSync(new URL('../android/app/src/main/java/com/bilimusic/player/MediaControlService.java', import.meta.url), 'utf8')
    const plugin = readFileSync(new URL('../android/app/src/main/java/com/bilimusic/player/MediaControlPlugin.java', import.meta.url), 'utf8')
    log(
      '悬浮窗卡片：控制行 + 前台隐藏',
      /ic_ov_prev/.test(service) &&
        /ic_ov_close/.test(service) &&
        /setAppVisible/.test(service) &&
        /applyOverlayVisibility/.test(service) &&
        /overlayClosed/.test(service)
    )
    log(
      '悬浮窗：拖拽区不拦截按钮点击',
      /attachDrag\(overlayLine, overlayParams, ""\)/.test(service) && /attachDrag\(overlayTrans, overlayParams, ""\)/.test(service) && !/card\.setOnTouchListener/.test(service)
    )
    {
      // P3 页面行内操作（榜单/日推/FM/歌手/专辑）：统一走 TrackActions（移动端 喜欢/下载/更多）
      const actions = readFileSync(new URL('../src/components/TrackActions.vue', import.meta.url), 'utf8')
      const rkCss = readFileSync(new URL('../src/styles/main.css', import.meta.url), 'utf8')
      const rkViews = ['RankView', 'DailyView', 'FmView', 'ArtistView', 'AlbumView'].map((v) =>
        readFileSync(new URL(`../src/views/${v}.vue`, import.meta.url), 'utf8')
      )
      log(
        'rk 行内操作：5 个视图接入 TrackActions（移动端 喜欢/下载/更多）',
        actions.includes('openActionSheet') &&
          /name="heart"/.test(actions) &&
          /name="more"/.test(actions) &&
          /rk-extra/.test(actions) &&
          /\.rk-row \.s-actions \.rk-extra/.test(rkCss) &&
          rkViews.every((src) => /<TrackActions :song="s" @play="playAt\(i\)"/.test(src)) &&
          rkViews.every((src) => !/onPlayNext/.test(src))
      )
    }
    {
      // P5 E2 评论写：签名网关 + store 票据守卫 + 详情页发表/回复/删除
      const commentApi = readFileSync(new URL('../src/api/qq/comment.js', import.meta.url), 'utf8')
      const commentStore = readFileSync(new URL('../src/store/songComments.js', import.meta.url), 'utf8')
      const songDetailView = readFileSync(new URL('../src/views/SongDetailView.vue', import.meta.url), 'utf8')
      log(
        '评论写（P5 E2）：签名网关 + 票据守卫 + 发表/回复/删除 UI',
        /CommentWriteServer/.test(commentApi) &&
          /writeCall/.test(commentApi) &&
          /buildAddCommentParam/.test(commentApi) &&
          /ensureWritable/.test(commentStore) &&
          /export async function postComment/.test(commentStore) &&
          /export async function removeComment/.test(commentStore) &&
          /submitComment/.test(songDetailView) &&
          /startReply/.test(songDetailView) &&
          /onDeleteComment/.test(songDetailView)
      )
    }
    {
      // P5 E3 分享：核心桥 + 原生系统分享注入 + 分享面板（二维码/复制）
      const coreShare = readFileSync(new URL('../src/core/share.js', import.meta.url), 'utf8')
      const nativeShare = readFileSync(new URL('../src/platform/native/share.js', import.meta.url), 'utf8')
      const shareDialog = readFileSync(new URL('../src/components/ShareDialog.vue', import.meta.url), 'utf8')
      log(
        '分享（P5 E3）：核心桥 + 原生系统分享 + 二维码面板',
        /setShareBackend/.test(coreShare) &&
          /canSystemShare/.test(coreShare) &&
          /@capacitor\/share/.test(nativeShare) &&
          /QRCode\.toCanvas/.test(shareDialog) &&
          /writeClipboard/.test(shareDialog)
      )
    }
    {
      // P5 E5（可行部分）：关注歌手只读列表
      const followApi = readFileSync(new URL('../src/api/qq/follow.js', import.meta.url), 'utf8')
      const settings = readFileSync(new URL('../src/components/SettingsDialog.vue', import.meta.url), 'utf8')
      log(
        '关注歌手（P5 E5）：只读列表（好友接口 1001 / 无写方法）',
        /music\.concern\.RelationList/.test(followApi) &&
          /parseFollowedSingers/.test(followApi) &&
          /fetchFollowedSingers/.test(settings) &&
          /loadFollowed/.test(settings)
      )
    }
    {
      // 逐字渲染重构（2026-09-27）：LyricLine 子组件 + 统一配色 + iframe 歌词时钟外推
      const lyricLine = readFileSync(new URL('../src/components/LyricLine.vue', import.meta.url), 'utf8')
      const npSrc = readFileSync(new URL('../src/components/NowPlaying.vue', import.meta.url), 'utf8')
      const lyricStore = readFileSync(new URL('../src/store/lyric.js', import.meta.url), 'utf8')
      const lyricCss = readFileSync(new URL('../src/styles/main.css', import.meta.url), 'utf8')
      log(
        '逐字渲染：LyricLine 子组件（仅当前行响应时间）+ 0.1% 进度',
        /<LyricLine/.test(npSrc) && /wordState/.test(lyricLine) && /toFixed\(1\)/.test(lyricLine) && /lyricNow/.test(lyricLine)
      )
      log(
        '逐字配色统一（已唱=品牌绿，无白色跳变）+ iframe 歌词时钟外推',
        /\.l-word\.done\s*\{\s*color:\s*var\(--brand\)/.test(lyricCss) &&
          !/\.l-word\.done\s*\{\s*color:\s*var\(--text\)/.test(lyricCss) &&
          /extrapolateTime/.test(lyricStore) &&
          /export const lyricNow/.test(lyricStore)
      )
    }
    {
      // 搜索小增强（2026-09-27）：历史单条删除 + 热搜「换一换」（窗口轮换，无新请求）
      const searchStoreSrc = readFileSync(new URL('../src/store/search.js', import.meta.url), 'utf8')
      const searchViewSrc = readFileSync(new URL('../src/views/SearchView.vue', import.meta.url), 'utf8')
      log(
        '搜索增强：历史单条删除 + 热搜换一换（窗口轮换）',
        /export function removeSearchHistory/.test(searchStoreSrc) &&
          /refreshHot/.test(searchViewSrc) &&
          /HOT_WINDOW/.test(searchViewSrc) &&
          /sv-chip-x/.test(searchViewSrc) &&
          /limit: 30/.test(searchViewSrc)
      )
    }
    {
      // 通知栏 / 迷你播放器歌词行（2026-09-27）
      const mediaSessionSrc = readFileSync(new URL('../src/store/mediaSession.js', import.meta.url), 'utf8')
      const miniSrc = readFileSync(new URL('../src/store/miniPlayer.js', import.meta.url), 'utf8')
      const pluginSrc = readFileSync(new URL('../android/app/src/main/java/com/bilimusic/player/MediaControlPlugin.java', import.meta.url), 'utf8')
      const serviceSrc = readFileSync(new URL('../android/app/src/main/java/com/bilimusic/player/MediaControlService.java', import.meta.url), 'utf8')
      log(
        '通知栏/迷你卡歌词行：JS 行级推送',
        /currentLyricLine/.test(mediaSessionSrc) &&
          /lyric: currentLyricLine/.test(mediaSessionSrc) &&
          /watch\(currentLyricLine/.test(mediaSessionSrc) &&
          /lyric: currentLyricLine/.test(miniSrc) &&
          /watch\(currentLyricLine/.test(miniSrc)
      )
      log(
        '通知栏/迷你卡歌词行：原生渲染（歌词进 contentText + 歌手进 subText + 迷你卡第三行）',
        /mediaLyric/.test(pluginSrc) &&
          /miniLyric/.test(pluginSrc) &&
          /notifyLyric/.test(serviceSrc) &&
          /setSubText\(artist\)/.test(serviceSrc) &&
          /miniLyricView/.test(serviceSrc)
      )
    }
    {
      // 歌单批量选择（体验收尾②）：SongRow 选择模式 + 选择条 + 批量移除二次确认
      const songRowSrc = readFileSync(new URL('../src/components/SongRow.vue', import.meta.url), 'utf8')
      const plViewSrc = readFileSync(new URL('../src/views/PlaylistView.vue', import.meta.url), 'utf8')
      const plWriteSrc = readFileSync(new URL('../src/store/playlistWrite.js', import.meta.url), 'utf8')
      log(
        '歌单批量选择：SongRow 选择模式（勾选框 + 屏蔽播放键/行内操作）',
        /selectable: \{ type: Boolean/.test(songRowSrc) &&
          /toggle-select/.test(songRowSrc) &&
          /class="pick"/.test(songRowSrc) &&
          /v-if="!selectable" class="row-actions"/.test(songRowSrc) &&
          /v-if="selectable" class="pick"/.test(songRowSrc)
      )
      log(
        '歌单批量选择：选择条（全选/加入歌单/移除）+ 批量移除走二次确认',
        /selectMode = ref\(false\)/.test(plViewSrc) &&
          /toggleSelectAll/.test(plViewSrc) &&
          /openPlaylistPicker\(selectedSongs\)/.test(plViewSrc) &&
          /export async function removeSongsFromPlaylist/.test(plWriteSrc) &&
          /askConfirm\(\{/.test(plWriteSrc)
      )
    }
    {
      // 触屏红心「点了没变化」（2026-09-27）：WebView 点按后会粘住 :hover，
      // 未喜欢的心被 .np-act.fav-btn:hover 染成玫瑰红 → hover 规则必须限定 (hover: hover)
      const cssSrc = readFileSync(new URL('../src/styles/main.css', import.meta.url), 'utf8')
      const writeSrc = readFileSync(new URL('../src/api/qq/write.js', import.meta.url), 'utf8')
      log(
        '触屏红心：fav hover 仅在真 hover 设备生效',
        /@media \(hover: hover\) \{\s*\.np-act\.fav-btn:hover/.test(cssSrc) &&
          /@media \(hover: hover\) \{\s*\.icon-btn:hover/.test(cssSrc) &&
          /@media \(hover: hover\) \{\s*\.np-act:hover/.test(cssSrc)
      )
      log('写错误码 2001 中文化（操作过于频繁，保留原始码）', /2001: '操作过于频繁/.test(writeSrc))
    }
    {
      // 窄屏滑动手势（2026-09-27）：右滑开侧栏 / 左滑开播放队列；展开态反向滑收起
      const appSrc = readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8')
      const queueSrc = readFileSync(new URL('../src/components/QueuePanel.vue', import.meta.url), 'utf8')
      const cssSrc = readFileSync(new URL('../src/styles/main.css', import.meta.url), 'utf8')
      log(
        '侧栏手势：右滑开（一级页面，含最近播放/报告）+ 左滑开队列 + 反向滑收（任意页面）',
        /function isNarrowScreen\(\)/.test(appSrc) &&
          /matchMedia\('\(max-width: 768px\)'\)/.test(appSrc) &&
          /isFirstLevelPath\(route\.path\)/.test(appSrc) &&
          /Math\.abs\(dx\) < 60 \|\| Math\.abs\(dx\) <= Math\.abs\(dy\) \* 1\.4/.test(appSrc) &&
          /if \(state\.ui\.sidebarOpen\) \{\s*if \(dx < 0\) closeSidebar\(\)/.test(appSrc) &&
          /if \(state\.ui\.queueOpen\) \{\s*if \(dx > 0\) closeQueue\(\)/.test(appSrc) &&
          /if \(dx > 0\) openSidebar\(\)\s*else openQueue\(\)/.test(appSrc) &&
          /class="body"[\s\S]{0,200}@touchstart\.passive="onSwipeStart"/.test(appSrc) &&
          /onPanelSwipeEnd/.test(queueSrc) &&
          /dx >= 60 && dx > Math\.abs\(dy\) \* 1\.4\) closeQueue\(\)/.test(queueSrc) &&
          /class="queue-overlay"[\s\S]{0,200}@touchstart\.passive="onPanelSwipeStart"/.test(queueSrc)
      )
      log(
        '队列改右侧边栏样式 + 窄屏冷启动默认展开左侧栏',
        /\.queue-panel \{\s*width: min\(86vw, 360px\);\s*height: 100%;/.test(cssSrc) &&
          /@keyframes queueSlideIn/.test(cssSrc) &&
          !/\.queue-overlay \{[\s\S]{0,160}align-items: flex-end/.test(cssSrc) &&
          /location\.hash === ''[\s\S]{0,240}state\.ui\.sidebarOpen = true/.test(appSrc)
      )
    }
    log(
      '迷你播放器（H2）：服务 + 插件方法 + 互斥',
      /miniEnabled/.test(service) &&
        /setMiniPlayer/.test(plugin) &&
        /updateMiniPlayer/.test(plugin) &&
        /miniToggle|miniPrev|miniNext|miniClosed/.test(service) &&
        /attachDrag\(texts, miniParams, "mini"\)/.test(service)
    )
    const widget = readFileSync(new URL('../android/app/src/main/java/com/bilimusic/player/MiniWidgetProvider.java', import.meta.url), 'utf8')
    const widgetInfo = readFileSync(new URL('../android/app/src/main/res/xml/bmp_widget_info.xml', import.meta.url), 'utf8')
    const widgetLayout = readFileSync(new URL('../android/app/src/main/res/layout/widget_mini.xml', import.meta.url), 'utf8')
    const manifest = readFileSync(new URL('../android/app/src/main/AndroidManifest.xml', import.meta.url), 'utf8')
    log(
      '桌面小组件（H3）：provider + 布局 + 清单注册 + 服务推送',
      /class MiniWidgetProvider extends AppWidgetProvider/.test(widget) &&
        /ACTION_TOGGLE/.test(widget) &&
        /ACTION_NEXT/.test(widget) &&
        /appwidget-provider/.test(widgetInfo) &&
        /widget_title/.test(widgetLayout) &&
        /MiniWidgetProvider/.test(manifest) &&
        /APPWIDGET_UPDATE/.test(manifest) &&
        /MiniWidgetProvider\.updateAll/.test(service)
    )
    const librarySrc = readFileSync(new URL('../src/store/library.js', import.meta.url), 'utf8')
    log(
      'D3 读取：收藏歌单优先 musicu PlaylistFavRead（旧接口兜底）',
      /fetchPlaylistFavs/.test(librarySrc) && /fetchCollectedSmart/.test(librarySrc) && /fetchCollectedPlaylists/.test(librarySrc)
    )
    log(
      '通知栏：进度条 + 桌面歌词开关动作（两态图标）',
      /setProgress\(/.test(service) &&
        /ACTION_TOGGLE_OVERLAY/.test(service) &&
        /ic_stat_lyrics_on/.test(service) &&
        /ic_stat_lyrics_off/.test(service)
    )
    log(
      '通知栏动作图标用自绘矢量（避免系统位图主题化黑边）',
      !/android\.R\.drawable\.ic_media_/.test(service) &&
        /R\.drawable\.ic_ov_prev/.test(service) &&
        /R\.drawable\.ic_ov_pause/.test(service) &&
        /R\.drawable\.ic_ov_next/.test(service)
    )
    log(
      '插件接入前后台生命周期',
      /handleOnStart/.test(plugin) && /handleOnStop/.test(plugin) && /setAppVisible\(true\)/.test(plugin)
    )
  }
  }
  const loginSrc = readFileSync(new URL('../src/components/LoginDialog.vue', import.meta.url), 'utf8')
  log('LoginDialog 定义了 close()', /function close\(\)/.test(loginSrc))
  log('LoginDialog 模板使用 close 且已定义', /@click\.self="close"/.test(loginSrc))
  const serverSrc = readFileSync(new URL('../server/qq-login.js', import.meta.url), 'utf8')
  log('登录会话有定时清理', /setInterval\([\s\S]{0,120}login\.sweep/.test(serverSrc))
  const coreLogin = readFileSync(new URL('../src/core/qqLogin.js', import.meta.url), 'utf8')
  log('会话过期清理逻辑在核心内', /function sweep\(\)/.test(coreLogin) && /SESSION_TTL/.test(coreLogin))
  log('登录核心平台无关（无 node: 专有 API）', !/node:crypto|node:fs|Buffer\.from\(await/.test(coreLogin))
  log(
    '登录核心依赖注入 transport（移动端可复用）',
    /createQqLogin\(\{\s*transport/.test(serverSrc) && /opts\.transport|transport\s*}\s*=\s*\{\}/.test(coreLogin)
  )
}

// ---------- 4a-2. 登录方式持久化（真实运行：store 加载时从 bmp:config 恢复） ----------
console.log('\n=== 登录方式持久化（运行时） ===')
{
  const mem = new Map()
  // 尽量贴近真实 Storage：可枚举（Object.keys）、有 length/key（清理旧缓存依赖枚举）
  const shim = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => {
      mem.set(k, String(v))
      shim[k] = String(v)
    },
    removeItem: (k) => {
      mem.delete(k)
      delete shim[k]
    },
    key: (i) => [...mem.keys()][i] ?? null,
    get length() {
      return mem.size
    },
  }
  Object.defineProperty(globalThis, 'localStorage', { value: shim, configurable: true, writable: true })
  mem.set('bmp:config', JSON.stringify({ qqCookie: 'uin=10001; qm_keyst=x', uin: '10001', loginMethod: 'web' }))
  const mod = await import(`../src/store/index.js?t=${Date.now()}`)
  log(
    '重启后从 config 恢复登录方式（诊断不再误报「未知」）',
    mod.state.loginMethod === 'web',
    `loginMethod=${JSON.stringify(mod.state.loginMethod)}`
  )
  log('同时恢复登录态（uin + Cookie）', mod.state.config.uin === '10001' && /qm_keyst/.test(mod.state.config.qqCookie))
  // 缓存里混进「我喜欢」(id=201) 时，恢复阶段就要剔掉，侧栏「创建的歌单」不会重复
  mem.set(
    'bmp:userdata',
    JSON.stringify({
      uin: '10001',
      playlists: [
        { id: '201', dirId: 201, name: '我喜欢', songCount: 8, kind: 'created' },
        { id: '7011264340', dirId: 3, name: '自建歌单', songCount: 3, kind: 'created' },
      ],
    })
  )
  // 注意：store 已按域拆分，`index.js?t=` 只会重跑 barrel，子模块仍被 ESM 缓存；
  // 这里直接对 state.js 做缓存穿透，才能重新执行「启动时灌缓存」的 hydrateUserData。
  const mod2 = await import(`../src/store/state.js?t=${Date.now()}-hydrate`)
  const names = mod2.state.playlists.map((p) => p.name)
  log('缓存恢复时剔除「我喜欢」', !names.includes('我喜欢') && names.includes('自建歌单'), JSON.stringify(names))
  log('hydrate 标记随缓存命中', mod2.hydratedFromCache === true)
}

// ---------- 4a-3.「创建的歌单」接口层过滤（注入 transport，真实数据形态） ----------
console.log('\n=== 「创建的歌单」接口层过滤（真实数据形态） ===')
{
  const { setRequestTransport } = await import('../src/core/http.js')
  const { fetchUserPlaylists } = await import('../src/api/qq.js')
  // 该形态来自设备缓存实测：「我喜欢」的 dirid 是 201，但 tid 是 dissid（如 111111）而不是 201，
  // 所以只按 tid 判会漏 —— 实现里 dirid/tid 两个都判。
  setRequestTransport(
    createMockTransport([{ match: /fcg_user_created_diss/, respond: loadFixture('qq/user-created-diss.json') }], {
      label: '创建的歌单',
    })
  )
  const list = await fetchUserPlaylists('10001', 'uin=1; qm_keyst=x')
  log(
    '接口层剔除「我喜欢」与 QZone，只留真实自建歌单',
    list.length === 1 && list[0].name === '我的自建歌单' && list[0].id === '7011264340',
    JSON.stringify(list.map((p) => `${p.name}(${p.id})`))
  )
  setRequestTransport(null)
}

// ---------- 4a-4. mock transport / fixture 脚手架自检 ----------
console.log('\n=== mock transport / fixture 脚手架 ===')
{
  const { setRequestTransport } = await import('../src/core/http.js')
  const { fetchSongUrl, fetchLikedSongs } = await import('../src/api/qq.js')

  // 自检：未命中路由必须抛错，避免测试静默打到真实网络
  let unmatchedError = ''
  try {
    await createMockTransport([{ match: /never-match/, respond: {} }])('https://example.com/x', {})
  } catch (e) {
    unmatchedError = e.message
  }
  log('未匹配请求直接抛错（不落到真实网络）', /未匹配的请求/.test(unmatchedError), unmatchedError)

  const transport = createMockTransport(
    [
      { match: /musicu\.fcg/, respond: (url, init) => {
        const body = parseMusicuBody(init)
        if (body?.req_0?.module === 'vkey.GetVkeyServer') return loadFixture('qq/song-url.json')
        if (body?.req_0?.module === 'music.srfDissInfo.DissInfo') return loadFixture('qq/liked-page.json')
        throw new Error(`未覆盖的 musicu 调用：${body?.req_0?.module}`)
      } },
    ],
    { label: 'qq-musicu' }
  )
  setRequestTransport(transport)

  const url = await fetchSongUrl('004Z8Ihr0JIu5s', '10000', 'uin=10000; qm_keyst=fake')
  log(
    'fetchSongUrl 从 fixture 解析 vkey 直链',
    url === 'https://isure.stream.qqmusic.qq.com/C400004Z8Ihr0JIu5s.m4a?vkey=FAKEVKEYFORTEST&guid=1234567890&uin=10000&fromtag=66',
    url
  )
  const { songs, total } = await fetchLikedSongs('10000', 'euin-fake', 'uin=10000; qm_keyst=fake')
  log(
    'fetchLikedSongs 从 fixture 映射歌曲字段',
    songs.length === 2 && songs[0].name === '晴天' && songs[0].singers[0] === '周杰伦' && total === 2,
    JSON.stringify(songs.map((s) => `${s.name}/${s.album}`))
  )
  log('mock 记录了全部调用（便于断言请求参数）', transport.calls.length === 2, String(transport.calls.length))
  const lastBody = parseMusicuBody(transport.calls[1].init)
  log('musicu 请求带 comm.uin', lastBody?.comm?.uin === '10000', JSON.stringify(lastBody?.comm))
  setRequestTransport(null)
}

// ---------- 4a-5. 播放队列（运行时） ----------
console.log('\n=== 播放队列（运行时） ===')
{
  // 复用 4a-2 注入的 localStorage shim（plain 模块图已加载，这里拿到同一个单例）
  const store = await import('../src/store/index.js')
  const { state, setQueueFromSongs, playNext, addToQueue, removeFromQueue, moveQueueItem, clearQueue } = store
  const mk = (id, name) => ({ id, name, singers: ['测试歌手'], interval: 100 })

  setQueueFromSongs([mk('q1', 'A'), mk('q2', 'B'), mk('q3', 'C')])
  log(
    '加载歌单后队列自动重建',
    state.queue.length === 3 && state.player.queueIndex === -1 && state.queue[0].key === 'q1',
    JSON.stringify(state.queue.map((e) => e.key))
  )
  log(
    '队列持久化到 bmp:queue',
    JSON.parse(globalThis.localStorage.getItem('bmp:queue') || '{}').songs?.length === 3
  )

  playNext(mk('q4', 'D'))
  log('无当前曲时「下一首播放」插到队首', state.queue[0].key === 'q4', JSON.stringify(state.queue.map((e) => e.key)))
  playNext(mk('q2', 'B'))
  log('已在队列的歌会移到插入点（不重复）', state.queue.map((e) => e.key).join(',') === 'q2,q4,q1,q3', JSON.stringify(state.queue.map((e) => e.key)))

  addToQueue(mk('q2', 'B'))
  log('重复「加入队列」不生效', state.queue.length === 4)
  addToQueue(mk('q5', 'E'))
  log('「加入队列」追加到末尾', state.queue[4].key === 'q5' && state.queue.length === 5)

  state.player.queueIndex = 1 // 模拟正在播放 q4
  playNext(mk('q6', 'F'))
  log('有当前曲时插到其后', state.queue[2].key === 'q6', JSON.stringify(state.queue.map((e) => e.key)))
  log('插入后当前下标不变', state.player.queueIndex === 1)

  moveQueueItem(0, 3)
  log('拖动排序生效', state.queue.map((e) => e.key).join(',') === 'q4,q6,q1,q2,q3,q5', JSON.stringify(state.queue.map((e) => e.key)))
  log('拖动排序后当前曲下标跟随', state.player.queueIndex === 0)

  removeFromQueue(5)
  log('移出队列末尾', state.queue.length === 5 && !state.queue.some((e) => e.key === 'q5'))
  state.player.queueIndex = 2
  removeFromQueue(2)
  log(
    '移出当前曲会停止播放并顺延到下一位',
    !state.player.playing && state.player.source === 'none' && state.queue[2].key === 'q2',
    JSON.stringify(state.queue.map((e) => e.key))
  )

  clearQueue()
  log('清空队列', state.queue.length === 0 && state.player.queueIndex === -1)
  log('清空后持久化同步', JSON.parse(globalThis.localStorage.getItem('bmp:queue') || '{}').songs?.length === 0)
}

// ---------- 4a-6. 最近播放（运行时） ----------
console.log('\n=== 最近播放（运行时） ===')
{
  const store = await import('../src/store/index.js')
  const { state, recordHistory, clearHistory } = store
  const mk = (id, name) => ({ id, name, singers: ['测试歌手'], interval: 100 })

  clearHistory()
  recordHistory(mk('h1', 'A'))
  recordHistory(mk('h2', 'B'))
  recordHistory(mk('h1', 'A'))
  log(
    '播放过即记录：重复播放去重并移到最前',
    state.history.length === 2 && state.history[0].key === 'h1' && state.history[1].key === 'h2',
    JSON.stringify(state.history.map((h) => h.key))
  )
  log('最近播放持久化到 bmp:history', JSON.parse(globalThis.localStorage.getItem('bmp:history') || '[]').length === 2)

  for (let i = 0; i < 205; i++) recordHistory(mk('cap' + i, 'X' + i))
  log('历史上限 200 且保留最新', state.history.length === 200 && state.history[0].key === 'cap204', String(state.history.length))

  clearHistory()
  log(
    '清空最近播放（内存 + 持久化）',
    state.history.length === 0 && JSON.parse(globalThis.localStorage.getItem('bmp:history') || '[]').length === 0
  )
}

// ---------- 4a-7. 睡眠定时（运行时） ----------
console.log('\n=== 睡眠定时（运行时） ===')
{
  const store = await import('../src/store/index.js')
  const { state, setSleepTimer, cancelSleepTimer } = store

  setSleepTimer(30)
  log(
    '睡眠定时开启（记录时长与到点时间）',
    state.sleep.minutes === 30 && state.sleep.endsAt > Date.now() && state.sleep.remaining > 0,
    JSON.stringify(state.sleep)
  )
  cancelSleepTimer()
  log('睡眠定时可取消', state.sleep.endsAt === 0 && state.sleep.remaining === 0)

  setSleepTimer(1 / 60) // 1 秒后到点
  await new Promise((r) => setTimeout(r, 1600))
  log(
    '到点自动暂停并复位',
    state.sleep.endsAt === 0 && state.sleep.minutes === 0 && state.player.playing === false,
    JSON.stringify(state.sleep)
  )
}

// ---------- 4a-8. 歌词（fixture + 缓存） ----------
console.log('\n=== 歌词（fixture + 缓存） ===')
{
  const { setRequestTransport } = await import('../src/core/http.js')
  const { fetchLyric } = await import('../src/api/qq/lyric.js')
  const store = await import('../src/store/index.js')
  const { state, loadLyric } = store

  // musicu（带 trans:1）优先，老接口作回退
  const transport = createMockTransport(
    [
      {
        match: /musicu\.fcg/,
        respond: (url, init) => {
          const body = parseMusicuBody(init)
          if (body?.req_1?.module === 'music.musichallSong.PlayLyricInfo') {
            if (body.req_1.param?.trans !== 1) throw new Error('musicu 歌词请求必须带 trans:1')
            return loadFixture('qq/lyric-musicu.json')
          }
          throw new Error(`未覆盖的 musicu 调用：${body?.req_1?.module || body?.req_0?.module}`)
        },
      },
      { match: /fcg_query_lyric_new/, respond: loadFixture('qq/lyric.json') },
    ],
    { label: 'lyric' }
  )
  setRequestTransport(transport)

  const { lyric, trans, source } = await fetchLyric('0039MnYb0qxYhV', '')
  log(
    '歌词走 musicu（trans:1）并解析 base64 LRC',
    source === 'musicu' && /第一句歌词/.test(lyric) && /First line/.test(trans),
    `${source} / ${lyric.split('\n').length} 行`
  )

  const song = { mid: 'LYRICFIX1', id: 'LYRICFIX1', name: '测试歌曲', singers: ['测试歌手'] }
  await loadLyric(song)
  log(
    'loadLyric 写入 state（含翻译合并）',
    state.lyric.lines.length === 3 && state.lyric.lines[0].trans === 'First line',
    JSON.stringify(state.lyric.lines)
  )
  log('歌词缓存到 bmp:lyric4:<mid>', !!globalThis.localStorage.getItem('bmp:lyric4:LYRICFIX1'))
  log(
    '旧版无翻译缓存会被清理',
    !globalThis.localStorage.getItem('bmp:lyric:LYRICFIX1') && !globalThis.localStorage.getItem('bmp:lyric2:LYRICFIX1')
  )

  // 缓存命中：清掉内存态 + 断开 transport，仍应能加载
  setRequestTransport(null)
  state.lyric = { key: '', lines: [], loading: false, error: '', source: '' }
  await loadLyric(song)
  log('缓存命中不依赖网络', state.lyric.lines.length === 3 && state.lyric.source === 'cache', state.lyric.source)

  // 无 songmid（本地 / 演示歌曲）不发请求：可命中缓存，否则只显示占位
  state.lyric = { key: '', lines: [], loading: false, error: '', source: '' }
  await loadLyric({ id: 'demo1', name: '演示歌曲', singers: [] })
  log(
    '无 songmid 不发请求（占位而非报错）',
    state.lyric.lines.length === 0 && state.lyric.loading === false && state.lyric.error === '暂无歌词',
    JSON.stringify(state.lyric)
  )

  log('只发过两次请求（1 次直连 + 1 次 loadLyric，其余走缓存）', transport.calls.length === 2, String(transport.calls.length))

  // 回退：musicu 返回空歌词（部分老歌）→ 走旧接口
  const fallbackTransport = createMockTransport(
    [
      { match: /musicu\.fcg/, respond: loadFixture('qq/lyric-musicu-empty.json') },
      { match: /fcg_query_lyric_new/, respond: loadFixture('qq/lyric.json') },
    ],
    { label: 'lyric-fallback' }
  )
  setRequestTransport(fallbackTransport)
  const fb = await fetchLyric('000AsKdb2Za9T4', '')
  log(
    'musicu 空歌词时回退旧接口',
    fb.source === 'legacy' && /第一句歌词/.test(fb.lyric),
    `${fb.source} / ${fb.lyric.length} 字符`
  )
  setRequestTransport(null)
}

// ---------- 4a-9. 歌词校准偏移（运行时） ----------
console.log('\n=== 歌词校准偏移（运行时） ===')
{
  const store = await import('../src/store/index.js')
  const { state, lyricOffsetFor, setLyricOffset, resetLyricOffset, LYRIC_OFFSET_MAX } = store
  const song = { mid: 'OFFSET1', id: 'OFFSET1', name: '校准测试', singers: [] }

  resetLyricOffset(song)
  log('默认偏移为 0', lyricOffsetFor(song) === 0)

  setLyricOffset(song, 500)
  setLyricOffset(song, 500)
  log('累加偏移（+1.0s）', lyricOffsetFor(song) === 1000, String(lyricOffsetFor(song)))
  // 落盘是 leading + trailing 节流（长按连续调整时避免高频写），等 trailing 写完再断言
  await new Promise((r) => setTimeout(r, 400))
  log(
    '偏移持久化到 bmp:lyric-offset',
    JSON.parse(globalThis.localStorage.getItem('bmp:lyric-offset') || '{}').OFFSET1 === 1000
  )

  setLyricOffset(song, LYRIC_OFFSET_MAX * 10)
  log('偏移夹取到 ±30s', lyricOffsetFor(song) === LYRIC_OFFSET_MAX, String(lyricOffsetFor(song)))
  setLyricOffset(song, -LYRIC_OFFSET_MAX * 10)
  log('负向同样夹取', lyricOffsetFor(song) === -LYRIC_OFFSET_MAX, String(lyricOffsetFor(song)))

  resetLyricOffset(song)
  log(
    '重置后清空内存与持久化',
    lyricOffsetFor(song) === 0 && !JSON.parse(globalThis.localStorage.getItem('bmp:lyric-offset') || '{}').OFFSET1
  )
  log('无 key 的歌曲偏移恒为 0（且不写盘）', lyricOffsetFor({ name: 'x' }) === 0)

  // 歌词缓存升级/清理不能动校准配置（用户调过的必须保留）
  localStorage.setItem('bmp:lyric:OLDKEY', '{"lines":[]}')
  setLyricOffset({ mid: 'KEEPOFFSET', id: 'KEEPOFFSET' }, 1500)
  await new Promise((r) => setTimeout(r, 400))
  await import(`../src/store/lyric.js?t=${Date.now()}-cleanup`)
  log(
    '旧歌词缓存被清理时保留校准偏移',
    !localStorage.getItem('bmp:lyric:OLDKEY') && lyricOffsetFor({ mid: 'KEEPOFFSET' }) === 1500,
    JSON.stringify({ old: localStorage.getItem('bmp:lyric:OLDKEY'), offset: lyricOffsetFor({ mid: 'KEEPOFFSET' }) })
  )
  resetLyricOffset({ mid: 'KEEPOFFSET', id: 'KEEPOFFSET' })
}

// ---------- 4a-11. 搜索接口（fixture + transport） ----------
console.log('\n=== 搜索接口（fixture） ===')
{
  const { setRequestTransport } = await import('../src/core/http.js')
  const { searchByType } = await import('../src/api/qq/search.js')
  const transport = createMockTransport(
    [
      {
        match: /search_for_qq_cp/,
        respond: (url) => {
          const u = new URL(url, 'http://local')
          const t = u.searchParams.get('t')
          const p = u.searchParams.get('p')
          if (t === '0') return loadFixture(`qq/search-song${p === '2' ? '-page2' : ''}.json`)
          if (t === '8') return loadFixture('qq/search-album.json')
          throw new Error(`未覆盖的搜索类型 t=${t}`)
        },
      },
      { match: /client_music_search_songlist/, respond: () => loadFixture('qq/search-playlist.json') },
    ],
    { label: 'search' }
  )
  setRequestTransport(transport)

  const songs = await searchByType('晴天', 'song', {})
  log(
    'searchByType 单曲（总数/下一页）',
    songs.list.length === 2 && songs.total === 600 && songs.hasMore === true,
    JSON.stringify({ n: songs.list.length, total: songs.total })
  )
  const page2 = await searchByType('晴天', 'song', { page: 2 })
  log('searchByType 第二页', page2.page === 2 && page2.list.length === 1 && page2.list[0].name === '搁浅', page2.list[0]?.name)
  const albums = await searchByType('叶惠美', 'album', {})
  log('searchByType 专辑', albums.list[0].name === '叶惠美' && albums.list[0].mid === '000MkMni19ClKG', albums.list[0]?.name)
  const pls = await searchByType('华语', 'playlist', {})
  log('searchByType 歌单（id 可用于 loadPlaylist）', pls.list[0].id === '7280525088' && pls.page === 1, pls.list[0]?.id)
  const singers = await searchByType('周杰伦', 'singer', {})
  log(
    'searchByType 歌手（单曲结果聚合）',
    singers.list.length === 2 && singers.list[0].name === '周杰伦' && singers.list[0].mid === '0025NhlN2yWrP4',
    JSON.stringify(singers.list.map((s) => s.name))
  )

  const before = transport.calls.length
  await searchByType('   ', 'song', {})
  log('空关键词不发请求', transport.calls.length === before, String(transport.calls.length - before))
  setRequestTransport(null)
}

// ---------- 4a-12. 热搜与联想（fixture + transport） ----------
console.log('\n=== 热搜与联想（fixture） ===')
{
  const { setRequestTransport } = await import('../src/core/http.js')
  const { fetchHotKeys, fetchSuggest, HOTKEY_MODULE, HOTKEY_METHOD } = await import('../src/api/qq/search.js')
  const transport = createMockTransport(
    [
      { match: /musicu\.fcg/, respond: () => loadFixture('qq/hotkey.json') },
      { match: /smartbox_new/, respond: () => loadFixture('qq/suggest.json') },
    ],
    { label: 'hot-suggest' }
  )
  setRequestTransport(transport)

  const hot = await fetchHotKeys({ limit: 3 })
  log('fetchHotKeys 限量解析', hot.length === 3 && hot[0].keyword === '易烊千玺dvd', JSON.stringify(hot.map((h) => h.keyword)))
  const body = parseMusicuBody(transport.calls[0].init)
  log(
    '热搜走 musicu（模块/方法正确）',
    body?.req_0?.module === HOTKEY_MODULE && body?.req_0?.method === HOTKEY_METHOD,
    JSON.stringify({ module: body?.req_0?.module, method: body?.req_0?.method })
  )

  const sug = await fetchSuggest('晴天')
  log(
    'fetchSuggest 单曲优先',
    sug.length === 8 && sug[0].type === 'song' && sug[0].name === '晴天' && sug[0].sub === '周杰伦',
    JSON.stringify(sug.slice(0, 2))
  )
  const q = new URL(transport.calls[1].url, 'http://local')
  log(
    '联想请求参数（key 原值 + g_tk）',
    q.pathname.endsWith('/smartbox_new.fcg') && q.searchParams.get('key') === '晴天' && q.searchParams.get('g_tk') === '5381',
    transport.calls[1].url
  )
  const before = transport.calls.length
  const empty = await fetchSuggest('   ')
  log('联想空关键词不发请求', empty.length === 0 && transport.calls.length === before, String(transport.calls.length - before))
  setRequestTransport(null)
}

// ---------- 4a-13. 排行榜（fixture + transport） ----------
console.log('\n=== 排行榜（fixture） ===')
{
  const { setRequestTransport } = await import('../src/core/http.js')
  const { fetchRankList, fetchRankDetail, RANK_MODULE } = await import('../src/api/qq/rank.js')
  const transport = createMockTransport(
    [
      {
        match: (url, init) => /musicu\.fcg/.test(url) && /ToplistInfoServer/.test(init?.body || ''),
        respond: (url, init) => {
          const method = parseMusicuBody(init)?.req_0?.method
          if (method === 'GetAll') return loadFixture('qq/rank-index.json')
          if (method === 'GetDetail') return loadFixture('qq/rank-detail.json')
          throw new Error(`未覆盖的榜单方法 ${method}`)
        },
      },
    ],
    { label: 'rank' }
  )
  setRequestTransport(transport)

  const groups = await fetchRankList()
  log(
    'fetchRankList 分组',
    groups.length === 2 && groups[0].name === '巅峰榜' && groups[0].lists.some((l) => l.id === 26),
    JSON.stringify(groups.map((g) => g.name))
  )
  const body0 = parseMusicuBody(transport.calls[0].init)
  log('榜单走 musicu（模块正确）', body0?.req_0?.module === RANK_MODULE, String(body0?.req_0?.module))

  const det = await fetchRankDetail(26, { num: 3 })
  log(
    'fetchRankDetail 合并结果',
    det.info.title === '热歌榜' && det.list.length === 3 && det.list[0].rank === 1 && det.list[0].name === '茶汤' && det.list[0].mid === '0027rBks3lqPA3',
    JSON.stringify(det.list[0])
  )
  const retryCall = parseMusicuBody(transport.calls[2].init)
  log(
    'period 空值自动重试（第二次带上游返回周期）',
    transport.calls.length === 3 && retryCall?.req_0?.param?.period === '2026-09-24',
    JSON.stringify({ calls: transport.calls.length, period: retryCall?.req_0?.param?.period })
  )
  setRequestTransport(null)
}

// ---------- 4a-14. 歌单广场与歌单详情（fixture + transport） ----------
console.log('\n=== 歌单广场与歌单详情（fixture） ===')
{
  const { setRequestTransport } = await import('../src/core/http.js')
  const { fetchSquareTags, fetchSquareList, ALL_CATEGORY_ID } = await import('../src/api/qq/square.js')
  const { fetchPlaylistSongs } = await import('../src/api/qq/playlist.js')
  const transport = createMockTransport(
    [
      { match: /fcg_get_diss_tag_conf/, respond: () => loadFixture('qq/square-tags.json') },
      {
        match: /fcg_get_diss_by_tag/,
        respond: (url) => {
          const u = new URL(url, 'http://local')
          return loadFixture(u.searchParams.get('sin') === '30' ? 'qq/square-list-page2.json' : 'qq/square-list.json')
        },
      },
      { match: /musicu\.fcg/, respond: () => loadFixture('qq/square-playlist.json') },
    ],
    { label: 'square' }
  )
  setRequestTransport(transport)

  const tags = await fetchSquareTags()
  log('fetchSquareTags 解析分组', tags.length === 2 && tags[0].tags[0].id === ALL_CATEGORY_ID, JSON.stringify(tags.map((g) => g.name)))
  const up = new URL(transport.calls[0].url, 'http://local')
  log(
    '分类请求参数（format / platform）',
    up.pathname.endsWith('/fcg_get_diss_tag_conf.fcg') && up.searchParams.get('format') === 'json' && up.searchParams.get('platform') === 'yqq.json',
    transport.calls[0].url
  )

  const page1 = await fetchSquareList({ categoryId: 11, sortId: 3, page: 1, pageSize: 30 })
  const q1 = new URL(transport.calls[1].url, 'http://local')
  log(
    '歌单列表请求参数（闭区间 sin/ein）',
    q1.searchParams.get('categoryId') === '11' && q1.searchParams.get('sortId') === '3' && q1.searchParams.get('sin') === '0' && q1.searchParams.get('ein') === '29',
    transport.calls[1].url
  )
  log(
    '歌单列表解析（总数/作者/封面上 https）',
    page1.list.length === 10 && page1.total === 11619 && page1.list[0].id === '7707261125' && page1.list[0].cover.startsWith('https://'),
    JSON.stringify(page1.list[0])
  )

  const page2 = await fetchSquareList({ page: 2 })
  const q2 = new URL(transport.calls[2].url, 'http://local')
  log('第二页 sin=30 / ein=59', q2.searchParams.get('sin') === '30' && q2.searchParams.get('ein') === '59', `${q2.searchParams.get('sin')}-${q2.searchParams.get('ein')}`)

  // 歌单详情：老接口 fcg_ucc_getcdinfo_byids_cp 已返回空 cdlist → 改 musicu CgiGetDiss
  const { playlist, songs } = await fetchPlaylistSongs('https://y.qq.com/n/ryqq/playlist/7707261125', '')
  const bodyP = parseMusicuBody(transport.calls[3].init)
  log(
    '歌单详情走 musicu CgiGetDiss（disstid/song_num）',
    bodyP?.req_0?.module === 'music.srfDissInfo.DissInfo' && bodyP?.req_0?.method === 'CgiGetDiss' && bodyP?.req_0?.param?.disstid === 7707261125 && bodyP?.req_0?.param?.song_num > 0,
    JSON.stringify(bodyP?.req_0?.param)
  )
  log(
    '歌单详情映射（名称/歌曲/作者兜底）',
    playlist.id === '7707261125' &&
      playlist.name.startsWith('甜度爆表') &&
      playlist.songCount === 3 &&
      songs.length === 3 &&
      songs[0].name === '你的' &&
      songs[0].singers[0] === 'DouDou' &&
      songs[0].mid === '002xTzGb2UBQRk' &&
      songs[0].cover.includes('0023VbHy1oT80v'),
    JSON.stringify({ name: playlist.name, songs: songs.map((s) => s.name) })
  )
  setRequestTransport(null)
}

// ---------- 4a-15. 每日推荐（fixture + transport） ----------
console.log('\n=== 每日推荐（fixture） ===')
{
  const { setRequestTransport } = await import('../src/core/http.js')
  const { fetchDailySongs, RADAR_MODULE } = await import('../src/api/qq/daily.js')
  const transport = createMockTransport(
    [
      {
        match: (url, init) => /musicu\.fcg/.test(url) && /GetRadarSong/.test(init?.body || ''),
        respond: (url, init) => {
          const page = parseMusicuBody(init)?.req_0?.param?.Page
          return loadFixture(page === 2 ? 'qq/daily-radar-page2.json' : 'qq/daily-radar.json')
        },
      },
    ],
    { label: 'daily' }
  )
  setRequestTransport(transport)

  const { songs, pages, hasMore } = await fetchDailySongs({ count: 5 })
  const names = songs.map((s) => s.name)
  log(
    'fetchDailySongs 跨页去重凑数（6 条 → 5 首）',
    songs.length === 5 && pages === 2 && new Set(names).size === 5 && names[3] === '我的歌声里' && names[4] === 'Letting Go',
    JSON.stringify({ names, pages })
  )
  log('雷达翻页 HasMore 透传', hasMore === true)
  const body1 = parseMusicuBody(transport.calls[0].init)
  const body2 = parseMusicuBody(transport.calls[1].init)
  log(
    '请求参数（模块正确 + 第二页 Page=2）',
    body1?.req_0?.module === RADAR_MODULE && body1?.req_0?.param?.Page === 1 && body2?.req_0?.param?.Page === 2,
    JSON.stringify({ m: body1?.req_0?.module, p1: body1?.req_0?.param?.Page, p2: body2?.req_0?.param?.Page })
  )

  const before = transport.calls.length
  const small = await fetchDailySongs({ count: 3 })
  log('凑满即停（count=3 只取 1 页）', small.songs.length === 3 && small.pages === 1 && transport.calls.length === before + 1, String(transport.calls.length - before))
  setRequestTransport(null)
}

// ---------- 4a-16. 搜索历史（运行时） ----------
console.log('\n=== 搜索历史（运行时） ===')
{
  const store = await import('../src/store/index.js')
    const { state, addSearchHistory, clearSearchHistory, removeSearchHistory } = store
  clearSearchHistory()
  addSearchHistory(' 晴天 ')
  addSearchHistory('稻香')
  addSearchHistory('晴天')
  log(
    '搜索历史去重上移（首条=晴天，共 2 条）',
    state.searchHistory[0] === '晴天' && state.searchHistory.length === 2,
    JSON.stringify(state.searchHistory)
  )
  log('搜索历史持久化到 bmp:search-history', JSON.parse(globalThis.localStorage.getItem('bmp:search-history') || '[]').length === 2)
  for (let i = 0; i < 25; i++) addSearchHistory('kw' + i)
  log('搜索历史上限 20', state.searchHistory.length === 20, String(state.searchHistory.length))
  // 单条删除（2026-09-27）：删掉中间一条，其余保留且持久化同步
  removeSearchHistory('kw10')
  log(
    '搜索历史单条删除（内存 + 持久化）',
    !state.searchHistory.includes('kw10') &&
      state.searchHistory.length === 19 &&
      !JSON.parse(globalThis.localStorage.getItem('bmp:search-history') || '[]').includes('kw10')
  )
  clearSearchHistory()
  log(
    '可清空（内存 + 持久化）',
    state.searchHistory.length === 0 && JSON.parse(globalThis.localStorage.getItem('bmp:search-history') || '[]').length === 0
  )
}

// ---------- 4a-17. 私人 FM（fixture + transport） ----------
console.log('\n=== 私人 FM（fixture） ===')
{
  const { setRequestTransport } = await import('../src/core/http.js')
  const { fetchFmBatch } = await import('../src/api/qq/fm.js')
  const transport = createMockTransport(
    [
      {
        match: (url, init) => /musicu\.fcg/.test(url) && /GetRadarSong/.test(init?.body || ''),
        respond: (url, init) => {
          const page = parseMusicuBody(init)?.req_0?.param?.Page
          return loadFixture(page === 2 ? 'qq/daily-radar-page2.json' : 'qq/daily-radar.json')
        },
      },
    ],
    { label: 'fm' }
  )
  setRequestTransport(transport)

  const b1 = await fetchFmBatch({ size: 5 })
  log(
    'fetchFmBatch 跨页凑数并去重（3+3 → 5）',
    b1.songs.length === 5 && b1.nextPage === 3 && new Set(b1.songs.map((s) => s.mid)).size === 5,
    JSON.stringify({ n: b1.songs.length, nextPage: b1.nextPage })
  )
  const b2 = await fetchFmBatch({ startPage: b1.nextPage, size: 2, exclude: b1.songs.map((s) => s.mid) })
  log(
    'exclude 跳过已出现（不重复，翻满 3 页仍为空）',
    b2.songs.length === 0 && b2.nextPage === 6,
    JSON.stringify({ got: b2.songs.length, nextPage: b2.nextPage })
  )
  const b3 = await fetchFmBatch({ size: 2 })
  log('凑满即停（size=2 只翻 1 页）', b3.songs.length === 2 && b3.nextPage === 2, String(b3.nextPage))
  setRequestTransport(null)
}

// ---------- 4a-18. 歌手页（fixture + transport） ----------
console.log('\n=== 歌手页（fixture） ===')
{
  const { setRequestTransport } = await import('../src/core/http.js')
  const { fetchArtistDetail, fetchArtistSongs, fetchArtistAlbums, fetchSimilarArtists } = await import('../src/api/qq/artist.js')
  const transport = createMockTransport(
    [
      {
        match: /musicu\.fcg/,
        respond: (url, init) => {
          const body = parseMusicuBody(init)
          const module = body?.req_0?.module
          if (module === 'music.web_singer_info_svr') return loadFixture('qq/artist-detail.json')
          if (module === 'musichall.song_list_server') return loadFixture('qq/artist-songs.json')
          if (module === 'music.musichallAlbum.AlbumListServer') return loadFixture('qq/artist-albums.json')
          if (module === 'music.SimilarSingerSvr') return loadFixture('qq/artist-similar.json')
          throw new Error(`未覆盖的歌手模块 ${module}`)
        },
      },
    ],
    { label: 'artist' }
  )
  setRequestTransport(transport)

  const det = await fetchArtistDetail('0025NhlN2yWrP4', { hotNum: 3 })
  const body0 = parseMusicuBody(transport.calls[0].init)
  log(
    'fetchArtistDetail（热门 + 请求参数）',
    det.info.name === '周杰伦' && det.hotSongs.length === 3 && body0?.req_0?.method === 'get_singer_detail_info' && body0?.req_0?.param?.singermid === '0025NhlN2yWrP4' && body0?.req_0?.param?.num === 3,
    JSON.stringify({ name: det.info.name, n: det.hotSongs.length, param: body0?.req_0?.param })
  )

  const songs = await fetchArtistSongs('0025NhlN2yWrP4', { begin: 0, num: 2 })
  const body1 = parseMusicuBody(transport.calls[1].init)
  log(
    'fetchArtistSongs（总数 + 分页参数）',
    songs.total === 1012 && songs.songs.length === 2 && body1?.req_0?.param?.singerMid === '0025NhlN2yWrP4' && body1?.req_0?.param?.num === 2,
    JSON.stringify({ total: songs.total, param: body1?.req_0?.param })
  )

  const albums = await fetchArtistAlbums('0025NhlN2yWrP4')
  log('fetchArtistAlbums（总数 43 + 首张）', albums.total === 43 && albums.albums[0].name === '周杰伦的床边故事', JSON.stringify({ total: albums.total, first: albums.albums[0]?.name }))

  const sim = await fetchSimilarArtists('0025NhlN2yWrP4', { number: 5 })
  log('fetchSimilarArtists（头像 https）', sim.length >= 2 && sim[0].name === 'F.I.R.飞儿乐团' && sim[0].avatar.startsWith('https://'), JSON.stringify(sim.slice(0, 2).map((s) => s.name)))
  setRequestTransport(null)
}

// ---------- 4a-19. 专辑详情增强（fixture + transport） ----------
console.log('\n=== 专辑详情增强（fixture） ===')
{
  const { setRequestTransport } = await import('../src/core/http.js')
  const { fetchAlbumDetail, ALBUM_MODULE } = await import('../src/api/qq/album.js')
  const transport = createMockTransport([{ match: /musicu\.fcg/, respond: () => loadFixture('qq/album-detail.json') }], { label: 'album' })
  setRequestTransport(transport)

  const al = await fetchAlbumDetail('0024bjiL2aocxT')
  const body = parseMusicuBody(transport.calls[0].init)
  log(
    'fetchAlbumDetail（albumMId 参数 + 元信息）',
    body?.req_0?.module === ALBUM_MODULE && body?.req_0?.param?.albumMId === '0024bjiL2aocxT' && al.name === '十一月的萧邦' && al.company === '杰威尔音乐有限公司',
    JSON.stringify({ param: body?.req_0?.param, name: al.name })
  )
  let err = ''
  try {
    await fetchAlbumDetail('')
  } catch (e) {
    err = e.message
  }
  log('缺 albummid 直接报错（不发请求）', /缺少 albummid/.test(err) && transport.calls.length === 1, err)
  setRequestTransport(null)
}

// ---------- 4a-20. 歌曲详情（相似 + 评论，fixture + transport） ----------
console.log('\n=== 歌曲详情（fixture） ===')
{
  const { setRequestTransport } = await import('../src/core/http.js')
  const { fetchSimilarSongs, fetchComments } = await import('../src/api/qq/songDetail.js')
  const transport = createMockTransport(
    [
      { match: /musicu\.fcg/, respond: () => loadFixture('qq/song-similar.json') },
      { match: /fcg_global_comment_h5/, respond: () => loadFixture('qq/song-comments-synthetic.json') },
    ],
    { label: 'song-detail' }
  )
  setRequestTransport(transport)

  const sim = await fetchSimilarSongs(97773, { limit: 5 })
  const body = parseMusicuBody(transport.calls[0].init)
  log(
    'fetchSimilarSongs（数字 songid）',
    sim.length === 2 && body?.req_0?.module === 'music.recommend.TrackRelationServer' && body?.req_0?.param?.songid === 97773,
    JSON.stringify(body?.req_0?.param)
  )

  const cmt = await fetchComments(97773, { page: 0, pageSize: 3 })
  const u = new URL(transport.calls[1].url, 'http://local')
  log(
    'fetchComments（URL 参数齐全）',
    u.searchParams.get('topid') === '97773' &&
      u.searchParams.get('cid') === '205360772' &&
      u.searchParams.get('biztype') === '1' &&
      u.searchParams.get('pagenum') === '0' &&
      u.searchParams.get('pagesize') === '3',
    transport.calls[1].url
  )
  log(
    'fetchComments 解析（热评 / 最新 / 总数）',
    cmt.hot.length === 2 && cmt.hot[0].nick === '示例用户A' && cmt.list.length === 2 && cmt.total === 230665,
    JSON.stringify({ hot: cmt.hot.length, list: cmt.list.length, total: cmt.total })
  )

  let err1 = ''
  let err2 = ''
  try {
    await fetchSimilarSongs(0)
  } catch (e) {
    err1 = e.message
  }
  try {
    await fetchComments('')
  } catch (e) {
    err2 = e.message
  }
  log('缺 songid 直接报错（不发请求）', /缺少歌曲 ID/.test(err1) && /缺少歌曲 ID/.test(err2) && transport.calls.length === 2, `${err1} | ${err2}`)
  setRequestTransport(null)
}

// ---------- 4a-21. 写操作基础设施（签名网关，fixture + transport，绝不真写） ----------
console.log('\n=== 写操作基础设施（P4.0） ===')
{
  const { setRequestTransport } = await import('../src/core/http.js')
  const { writeCall, SIGNED_PATH } = await import('../src/api/qq/write.js')
  const { zzcSign } = await import('../src/core/zzcSign.js')
  const { getGtk } = await import('../src/core/qqLogin.js')
  const transport = createMockTransport([{ match: /musics\.fcg/, respond: () => ({ code: 0, req_0: { code: 0, data: { retCode: 0 } } }) }], {
    label: 'write',
  })
  setRequestTransport(transport)

  let err = ''
  try {
    await writeCall('music.musicasset.PlaylistDetailWrite', 'AddSonglist', { dirId: 201 }, { cookie: 'uin=1; p_skey=x', uin: '1' })
  } catch (e) {
    err = e.message
  }
  log('缺票据：抛错且**不发请求**', /qm_keyst|音乐票据/.test(err) && transport.calls.length === 0, err)

  const param = { dirId: 201, tid: 0, bFmtUtf8: true, v_songInfo: [{ songId: 97773, songType: 13 }] }
  await writeCall('music.musicasset.PlaylistDetailWrite', 'AddSonglist', param, { cookie: 'uin=1; qm_keyst=K', uin: '1' })
  const u = new URL(transport.calls[0].url, 'http://local')
  const body = parseMusicuBody(transport.calls[0].init)
  const bodyText = String(transport.calls[0].init?.body || '')
  log(
    '写请求走签名网关（路径 + sign 与请求体匹配）',
    u.pathname === SIGNED_PATH &&
      u.searchParams.get('sign') === (await zzcSign(bodyText)) &&
      /^zzc[a-z0-9]+$/.test(u.searchParams.get('sign') || ''),
    JSON.stringify({ path: u.pathname, sign: (u.searchParams.get('sign') || '').slice(0, 20) + '…' })
  )
  log(
    '签名写请求（g_tk / platform / 参数原样）',
    body?.comm?.g_tk === getGtk('K') &&
      body?.comm?.platform === 'yqq' &&
      body?.req_0?.module === 'music.musicasset.PlaylistDetailWrite' &&
      body?.req_0?.method === 'AddSonglist' &&
      body?.req_0?.param?.bFmtUtf8 === true &&
      body?.req_0?.param?.v_songInfo[0].songId === 97773,
    JSON.stringify({ g_tk: body?.comm?.g_tk, param: body?.req_0?.param })
  )

  // 错误路径：网关码 / 业务码 / retCode 都可读
  const errTransport = createMockTransport([{ match: /musics\.fcg/, respond: { code: 0, req_0: { code: 0, data: { retCode: 80105 } } } }], { label: 'write-err' })
  setRequestTransport(errTransport)
  let err2 = ''
  try {
    await writeCall('music.musicasset.PlaylistDetailWrite', 'AddSonglist', param, { cookie: 'uin=1; qm_keyst=K' })
  } catch (e) {
    err2 = e.message
  }
  log('retCode=80105 → 可读错误（上游拒绝）', /上游拒绝/.test(err2), err2)
  setRequestTransport(null)
}

// ---------- 4a-22. 红心（回显 + 加/删，fixture + transport，绝不真写） ----------
console.log('\n=== 红心（P4.1） ===')
{
  const { setRequestTransport } = await import('../src/core/http.js')
  const { fetchFavStates, addFav, delFav } = await import('../src/api/qq/fav.js')
  const transport = createMockTransport(
    [
      {
        match: /musicu\.fcg|musics\.fcg/,
        respond: (url, init) => {
          const method = parseMusicuBody(init)?.req_0?.method
          if (method === 'IsSongFanByMid') return { code: 0, req_0: { code: 0, data: { m_fan: { '0025NhlN2yWrP4': true, '0039MnYb0qxYhV': false } } } }
          if (method === 'AddSonglist' || method === 'DelSonglist') {
            return { code: 0, req_0: { code: 0, data: { retCode: 0, result: { songlist: [{ songId: 97773, existed: method === 'AddSonglist' ? 0 : 1 }] } } } }
          }
          throw new Error(`未覆盖的写方法 ${method}`)
        },
      },
    ],
    { label: 'fav' }
  )
  setRequestTransport(transport)

  const states = await fetchFavStates(['0025NhlN2yWrP4', '0039MnYb0qxYhV', '0025NhlN2yWrP4'], { cookie: 'uin=1; qm_keyst=K' })
  const reqBody = parseMusicuBody(transport.calls[0].init)
  log(
    'fetchFavStates：去重 + 回显',
    states['0025NhlN2yWrP4'] === true && states['0039MnYb0qxYhV'] === false && reqBody?.req_0?.param?.v_songMid.length === 2,
    JSON.stringify({ states, mids: reqBody?.req_0?.param?.v_songMid })
  )
  const before = transport.calls.length
  await fetchFavStates([], { cookie: 'uin=1; qm_keyst=K' })
  log('fetchFavStates：空列表不发请求', transport.calls.length === before)

  await addFav({ id: '97773', songType: 13, name: '晴天' }, { cookie: 'uin=1; qm_keyst=K', uin: '1' })
  const addBody = parseMusicuBody(transport.calls[transport.calls.length - 1].init)
  log(
    'addFav：AddSonglist + dirId=201 + 数字 songId',
    addBody?.req_0?.method === 'AddSonglist' && addBody?.req_0?.param?.dirId === 201 && addBody?.req_0?.param?.tid === 0 && addBody?.req_0?.param?.v_songInfo[0].songId === 97773,
    JSON.stringify(addBody?.req_0?.param)
  )
  await delFav({ id: '97773', songType: 13, name: '晴天' }, { cookie: 'uin=1; qm_keyst=K', uin: '1' })
  const delBody = parseMusicuBody(transport.calls[transport.calls.length - 1].init)
  log('delFav：DelSonglist（同参数结构）', delBody?.req_0?.method === 'DelSonglist' && delBody?.req_0?.param?.v_songInfo[0].songId === 97773)
  setRequestTransport(null)
}

// ---------- 4a-23. 歌单写操作（P4.4 / P4.6 / P4.7，fixture + transport，绝不真写） ----------
console.log('\n=== 歌单写操作（P4.4/P4.6/P4.7） ===')
{
  const { setRequestTransport } = await import('../src/core/http.js')
  const { createPlaylist, deletePlaylist, addSongsToPlaylist, removeSongsFromPlaylist, BATCH_SIZE } = await import('../src/api/qq/playlistWrite.js')
  const transport = createMockTransport(
    [
      {
        match: /musics\.fcg/,
        respond: (url, init) => {
          const body = parseMusicuBody(init)
          const m = body?.req_0?.method
          const p = body?.req_0?.param || {}
          if (m === 'AddPlaylist') return { code: 0, req_0: { code: 0, data: { retCode: 0, result: { dirId: 1, tid: 9783375556, dirName: p.dirName } } } }
          if (m === 'DelPlaylist') return { code: 0, req_0: { code: 0, data: { retCode: 0, result: { dirId: p.dirId } } } }
          if (m === 'AddSonglist' || m === 'DelSonglist') {
            return { code: 0, req_0: { code: 0, data: { retCode: 0, result: { songlist: (p.v_songInfo || []).map((x, i) => ({ ...x, existed: i === 0 ? 1 : 0 })) } } } }
          }
          throw new Error(`未覆盖的写方法 ${m}`)
        },
      },
    ],
    { label: 'pl-write' }
  )
  setRequestTransport(transport)

  const created = await createPlaylist('测试歌单', { cookie: 'uin=1; qm_keyst=K', uin: '1' })
  const b1 = parseMusicuBody(transport.calls[0].init)
  log(
    'createPlaylist（AddPlaylist 参数 + 解析）',
    created.dirId === 1 &&
      created.tid === 9783375556 &&
      b1?.req_0?.module === 'music.musicasset.PlaylistBaseWrite' &&
      b1?.req_0?.method === 'AddPlaylist' &&
      b1?.req_0?.param?.dirName === '测试歌单' &&
      Array.isArray(b1?.req_0?.param?.taglist),
    JSON.stringify({ created, param: b1?.req_0?.param })
  )

  await deletePlaylist(1, { cookie: 'uin=1; qm_keyst=K', uin: '1' })
  const b2 = parseMusicuBody(transport.calls[1].init)
  log('deletePlaylist（DelPlaylist + dirId）', b2?.req_0?.method === 'DelPlaylist' && b2?.req_0?.param?.dirId === 1, JSON.stringify(b2?.req_0?.param))

  const songs = Array.from({ length: BATCH_SIZE + 1 }, (_, i) => ({ id: String(1000 + i), name: `s${i}` }))
  const res = await addSongsToPlaylist(1, 9783375556, songs, { cookie: 'uin=1; qm_keyst=K', uin: '1' })
  const batchCalls = transport.calls.slice(2)
  const p1 = parseMusicuBody(batchCalls[0].init)
  const p2 = parseMusicuBody(batchCalls[1].init)
  log(
    '批量加歌：51 首 → 2 批（50 + 1）',
    batchCalls.length === 2 &&
      p1?.req_0?.param?.v_songInfo.length === 50 &&
      p2?.req_0?.param?.v_songInfo.length === 1 &&
      p1?.req_0?.param?.dirId === 1 &&
      p1?.req_0?.param?.tid === 9783375556 &&
      p1?.req_0?.param?.bFmtUtf8 === true,
    JSON.stringify({ batches: batchCalls.length, first: p1?.req_0?.param?.v_songInfo.length, second: p2?.req_0?.param?.v_songInfo.length })
  )
  log('批量加歌：existed 统计（每批首条 existed=1）', res.batches === 2 && res.existed === 2 && res.added === BATCH_SIZE - 1, JSON.stringify(res))

  await removeSongsFromPlaylist(1, 9783375556, [{ id: '1000' }], { cookie: 'uin=1; qm_keyst=K', uin: '1' })
  const bLast = parseMusicuBody(transport.calls[transport.calls.length - 1].init)
  log('删歌（DelSonglist + 数字 songId）', bLast?.req_0?.method === 'DelSonglist' && bLast?.req_0?.param?.v_songInfo[0].songId === 1000, JSON.stringify(bLast?.req_0?.param))
  setRequestTransport(null)
}

// ---------- 4a-24. 专辑/歌单收藏（P4.2/P4.3，fixture + transport，绝不真写） ----------
console.log('\n=== 专辑/歌单收藏（P4.2/P4.3） ===')
{
  const { setRequestTransport } = await import('../src/core/http.js')
  const { favAlbum, cancelFavAlbum, favPlaylist, cancelFavPlaylist } = await import('../src/api/qq/fav.js')
  const transport = createMockTransport(
    [
      {
        match: /musics\.fcg/,
        respond: (url, init) => {
          const method = parseMusicuBody(init)?.req_0?.method
          if (method === 'FavAlbum' || method === 'CancelFavAlbum') return { code: 0, req_0: { code: 0, data: { result: 0, v_failedAlbumId: [] } } }
          if (method === 'FavPlaylist' || method === 'CancelFavPlaylist') return { code: 0, req_0: { code: 0, data: { result: 0, v_failedPlaylistId: [] } } }
          throw new Error(`未覆盖的收藏方法 ${method}`)
        },
      },
    ],
    { label: 'fav-write' }
  )
  setRequestTransport(transport)

  const r1 = await favAlbum(60671, { cookie: 'uin=1; qm_keyst=K', uin: '1' })
  const b1 = parseMusicuBody(transport.calls[0].init)
  log(
    'favAlbum（FavAlbum + v_albumId 数字）',
    b1?.req_0?.module === 'music.musicasset.AlbumFavWrite' &&
      b1?.req_0?.method === 'FavAlbum' &&
      JSON.stringify(b1?.req_0?.param?.v_albumId) === '[60671]' &&
      r1.ok === true,
    JSON.stringify({ param: b1?.req_0?.param, ok: r1.ok })
  )
  await cancelFavAlbum(60671, { cookie: 'uin=1; qm_keyst=K', uin: '1' })
  log('cancelFavAlbum（CancelFavAlbum）', parseMusicuBody(transport.calls[1].init)?.req_0?.method === 'CancelFavAlbum')

  const r3 = await favPlaylist(7280525088, 'EUIN-TEST', { cookie: 'uin=1; qm_keyst=K', uin: '1' })
  const b3 = parseMusicuBody(transport.calls[2].init)
  log(
    'favPlaylist（PlaylistFavWrite + 加密 uin）',
    b3?.req_0?.module === 'music.musicasset.PlaylistFavWrite' &&
      b3?.req_0?.method === 'FavPlaylist' &&
      b3?.req_0?.param?.uin === 'EUIN-TEST' &&
      JSON.stringify(b3?.req_0?.param?.v_playlistId) === '[7280525088]' &&
      r3.ok === true,
    JSON.stringify({ param: b3?.req_0?.param })
  )
  await cancelFavPlaylist(7280525088, 'EUIN-TEST', { cookie: 'uin=1; qm_keyst=K', uin: '1' })
  log('cancelFavPlaylist（CancelFavPlaylist）', parseMusicuBody(transport.calls[3].init)?.req_0?.method === 'CancelFavPlaylist')

  // 失败清单 → ok=false（内层 result=0 也不能当成功）
  const errTransport = createMockTransport(
    [{ match: /musics\.fcg/, respond: { code: 0, req_0: { code: 0, data: { result: 0, v_failedPlaylistId: [7280525088] } } } }],
    { label: 'fav-write-err' }
  )
  setRequestTransport(errTransport)
  const r5 = await favPlaylist(7280525088, 'E', { cookie: 'uin=1; qm_keyst=K' })
  log('失败清单 → ok=false', r5.ok === false && r5.failed.length === 1, JSON.stringify(r5))

  let e1 = ''
  let e2 = ''
  try {
    await favAlbum('abc', { cookie: 'uin=1; qm_keyst=K' })
  } catch (e) {
    e1 = e.message
  }
  try {
    await favPlaylist(1, '', { cookie: 'uin=1; qm_keyst=K' })
  } catch (e) {
    e2 = e.message
  }
  log('参数缺失直接报错（不发请求）', /专辑数字 ID/.test(e1) && /euin/.test(e2) && errTransport.calls.length === 1, `${e1} | ${e2}`)
  setRequestTransport(null)
}

// ---------- 4a-25. 下载（P6，mock 后端 + mock 直链，绝不真下载） ----------
console.log('\n=== 下载（P6） ===')
{
  const { setRequestTransport } = await import('../src/core/http.js')
  const { setDownloadBackend } = await import('../src/core/downloads.js')
  const store = await import('../src/store/index.js')
  const { state, songKey, downloadSong, isDownloaded, removeDownload, queueDownloads, retryFailedDownloads, importLocalFiles, localMusicSongs } = store

  const calls = { download: 0, removed: [], cleared: 0, failNext: false }
  const makeBackend = (overrides = {}) => ({
    downloadAudio: async ({ url, key, onProgress }) => {
      calls.download += 1
      if (calls.failNext) {
        calls.failNext = false
        throw new Error('模拟下载失败')
      }
      onProgress?.(0.5)
      return { path: `p/${key}.m4s`, ext: '.m4s', uri: `file://p/${key}.m4s`, size: 1234 }
    },
    removeDownloadedFile: async (key) => {
      calls.removed.push(key)
    },
    downloadedFileInfo: async () => ({ exists: true, size: 1234, uri: 'file://x' }),
    writeLocalMusic: async ({ key, ext }) => ({ path: `l/${key}${ext}`, uri: `file://l/${key}${ext}` }),
    removeLocalMusic: async () => {},
    dirSize: async () => 0,
    clearDir: async () => {
      calls.cleared += 1
    },
    clearAudioCache: async () => {},
    audioCacheSize: async () => 0,
    dirs: { AUDIO_DIR: 'a', DOWNLOAD_DIR: 'd', LOCAL_DIR: 'l' },
    ...overrides,
  })
  setDownloadBackend(makeBackend())

  const transport = createMockTransport([{ match: /musicu\.fcg/, respond: () => loadFixture('qq/song-url.json') }], { label: 'dl' })
  setRequestTransport(transport)

  // 走 QQ 直链路径（偏好设 qq，mock vkey 直链）
  const song = { id: '1', mid: '004Z8Ihr0JIu5s', name: '晴天', singers: ['周杰伦'], interval: 100 }
  state.sourcePref[songKey(song)] = 'qq'
  const rec = await downloadSong(song)
  log(
    'downloadSong：QQ 直链 → 索引 done + 持久化',
    rec?.status === 'done' &&
      rec.source === 'qq' &&
      rec.size === 1234 &&
      rec.uri === `file://p/${songKey(song)}.m4s` &&
      isDownloaded(song) === true &&
      JSON.parse(globalThis.localStorage.getItem('bmp:downloads'))[songKey(song)]?.status === 'done',
    JSON.stringify({ status: rec?.status, source: rec?.source, size: rec?.size })
  )
  const before = calls.download
  await downloadSong(song)
  log('已下载不重复下载（幂等）', calls.download === before && before === 1, `calls=${calls.download}`)

  await removeDownload(song, { confirm: false })
  log('removeDownload：删文件 + 删索引', calls.removed.length === 1 && !isDownloaded(song) && !state.downloads[songKey(song)])

  // 失败路径：failed 索引 + 错误信息
  const song2 = { id: '2', mid: '0039MnYb0qxYhV', name: '七里香', singers: ['周杰伦'], interval: 100 }
  state.sourcePref[songKey(song2)] = 'qq'
  calls.failNext = true
  const r2 = await downloadSong(song2, { silent: true })
  log(
    '下载失败 → failed 索引 + 错误信息',
    r2 === null && state.downloads[songKey(song2)]?.status === 'failed' && /模拟下载失败/.test(state.downloads[songKey(song2)]?.error || ''),
    JSON.stringify(state.downloads[songKey(song2)])
  )

  // 批量队列：3 首（并发 2）+ 重试失败
  const songs = [1, 2, 3].map((i) => ({ id: String(100 + i), mid: `MOCKMID000${i}`, name: `批量${i}`, singers: ['x'], interval: 60 }))
  songs.forEach((s) => (state.sourcePref[songKey(s)] = 'qq'))
  calls.failNext = true // 第一首失败
  await queueDownloads(songs)
  const doneN = songs.filter((s) => isDownloaded(s)).length
  const failedN = state.downloadQueue.filter((x) => x.status === 'failed').length
  log('queueDownloads：并发 2 跑完，失败进清单', doneN === 2 && failedN === 1, JSON.stringify({ doneN, failedN, calls: calls.download }))
  await retryFailedDownloads()
  log('retryFailedDownloads：失败项重跑后完成', songs.every((s) => isDownloaded(s)), JSON.stringify(state.downloadQueue.map((x) => x.status)))

  // 本地导入（stub FileReader）
  globalThis.FileReader = class {
    readAsDataURL(file) {
      this.result = 'data:audio/mpeg;base64,QUJD'
      setTimeout(() => this.onload && this.onload(), 0)
    }
  }
  const imported = await importLocalFiles([{ name: '周杰伦 - 晴天.mp3', size: 999 }])
  const lm = state.localMusic[state.localMusic.length - 1]
  log(
    'importLocalFiles：解析文件名 + 索引 + 可播放数组',
    imported === 1 && lm?.name === '晴天' && lm?.singers?.[0] === '周杰伦' && localMusicSongs()[0]?.localUri?.startsWith('file://l/'),
    JSON.stringify(lm)
  )

  setRequestTransport(null)
  setDownloadBackend(null)
  delete globalThis.FileReader
}

// ---------- 4a-26. 付费受限识别（G2，fixture + transport） ----------
console.log('\n=== 付费受限识别（G2） ===')
{
  const { setRequestTransport } = await import('../src/core/http.js')
  const { fetchSongUrl, fetchSongUrlInfo } = await import('../src/api/qq/song.js')
  const transport = createMockTransport(
    [
      {
        match: /musicu\.fcg/,
        respond: (url, init) => {
          const mid = parseMusicuBody(init)?.req_0?.param?.songmid?.[0]
          if (mid === 'VIPMID') {
            return { code: 0, req_0: { code: 0, data: { sip: ['https://dl.stream.qqmusic.qq.com/'], midurlinfo: [{ songmid: mid, purl: '', result: 104003, filename: 'M500x.mp3' }] } } }
          }
          return {
            code: 0,
            req_0: { code: 0, data: { sip: ['http://dl.stream.qqmusic.qq.com/'], midurlinfo: [{ songmid: mid, purl: 'M500x.mp3?vkey=V', result: 0, filename: 'M500x.mp3' }] } },
          }
        },
      },
    ],
    { label: 'vkey' }
  )
  setRequestTransport(transport)

  const info = await fetchSongUrlInfo('OKMID', '1', '')
  log(
    'fetchSongUrlInfo：可播（http→https）',
    info.url === 'https://dl.stream.qqmusic.qq.com/M500x.mp3?vkey=V' && info.restriction === '' && info.result === 0,
    JSON.stringify(info)
  )
  const vip = await fetchSongUrlInfo('VIPMID', '1', '')
  log('fetchSongUrlInfo：VIP 受限', vip.url === '' && vip.restriction === 'vip_required' && vip.result === 104003, JSON.stringify(vip))
  const legacy = await fetchSongUrl('OKMID', '1', '')
  log('fetchSongUrl 旧契约（返回字符串直链）', legacy === info.url, legacy)
  setRequestTransport(null)
}

// ---------- 4a-27. 听歌统计（G4，运行时） ----------
console.log('\n=== 听歌统计（运行时） ===')
{
  const store = await import('../src/store/index.js')
  const { state, recordListenStart, recordListenProgress, flushStats, clearStats, statsFor } = store
  const mk = (id, name, singers = ['测试歌手']) => ({ id, name, singers, interval: 200 })

  clearStats()
  recordListenStart(mk('st1', 'A'), 'bili')
  recordListenProgress(30000)
  recordListenStart(mk('st2', 'B'), 'qq')
  recordListenProgress(45000)
  recordListenProgress(20000) // 只增不减
  flushStats()

  log(
    '播放开始记录事件（最新在前）+ 时长累积',
    state.listenStats.length === 2 && state.listenStats[0].key === 'st2' && state.listenStats[0].ms === 45000 && state.listenStats[1].ms === 30000,
    JSON.stringify(state.listenStats.map((e) => ({ key: e.key, ms: e.ms, source: e.source })))
  )
  const persisted = JSON.parse(globalThis.localStorage.getItem('bmp:listen-stats') || '[]')
  log('持久化到 bmp:listen-stats（flush 后）', persisted.length === 2 && persisted[0].key === 'st2')
  const sum = statsFor(0)
  log(
    'statsFor 汇总',
    sum.totalPlays === 2 && sum.totalMs === 75000 && sum.uniqueSongs === 2 && sum.topSongs[0].key === 'st2',
    JSON.stringify({ plays: sum.totalPlays, ms: sum.totalMs, songs: sum.uniqueSongs })
  )
  clearStats()
  log('清空统计（内存 + 持久化）', state.listenStats.length === 0 && JSON.parse(globalThis.localStorage.getItem('bmp:listen-stats') || '[]').length === 0)
}

// ---------- 4a-28. 歌单导入导出（G5，transport mock，绝不真写） ----------
console.log('\n=== 歌单导入导出（G5） ===')
{
  const { setRequestTransport } = await import('../src/core/http.js')
  const store = await import('../src/store/index.js')
  const { state, exportCurrentPlaylist, importPlaylistText, resolveConfirm, canExportPlaylist } = store
  const { setFileBackend } = await import('../src/core/files.js')

  // 导出：注入假文件后端，导出当前歌单（JSON / m3u）
  let saved = null
  setFileBackend({
    saveTextFile: async (name, text) => {
      saved = { name, text }
      return { path: name, size: text.length }
    },
  })
  state.playlist = { id: '701', name: '测试/歌单', cover: '', nick: '' }
  state.songs = [
    { mid: 'm1', id: 97773, name: '晴天', singers: ['周杰伦'], album: '叶惠美', interval: 269 },
    { mid: 'm2', id: 449205, name: '稻香', singers: ['周杰伦'], album: '魔杰座', interval: 223 },
  ]
  log('可导出判断（有歌单且有歌）', canExportPlaylist() === true)

  await exportCurrentPlaylist('json')
  log(
    '导出 JSON：文件名安全化 + 保存内容 + ui.lastExport',
    saved?.name === '测试_歌单.json' && JSON.parse(saved.text).format === 'bmp-playlist' && JSON.parse(saved.text).songs.length === 2 && state.ui.lastExport?.count === 2,
    saved?.name
  )
  await exportCurrentPlaylist('m3u')
  log(
    '导出 m3u：EXTINF + songDetail 链接',
    saved?.name === '测试_歌单.m3u' && saved.text.includes('#EXTM3U') && saved.text.includes('周杰伦 - 晴天') && saved.text.includes('songDetail/m1')
  )

  // 导入：mock 签名网关（AddPlaylist/AddSonglist）+ track info + 搜索补全
  const transport = createMockTransport(
    [
      {
        match: /musics\.fcg/,
        respond: (url, init) => {
          const body = parseMusicuBody(init)
          if (body?.req_0?.method === 'AddPlaylist') {
            return { code: 0, req_0: { code: 0, data: { result: { dirId: 9001, tid: 777, dirName: body.req_0.param.dirName } } } }
          }
          if (body?.req_0?.method === 'AddSonglist') {
            return { code: 0, req_0: { code: 0, data: { result: { songlist: (body.req_0.param.v_songInfo || []).map(() => ({ existed: 0 })) } } } }
          }
          return { code: 0, req_0: { code: 0, data: {} } }
        },
      },
      {
        match: /musicu\.fcg/,
        respond: (url, init) => {
          const mids = parseMusicuBody(init)?.req_0?.param?.mids || []
          const tracks = mids.map((mid) => ({
            id: mid === 'm1' ? 97773 : 449205,
            mid,
            name: mid === 'm1' ? '晴天' : '稻香',
            singer: [{ name: '周杰伦' }],
            interval: 200,
            type: 0,
          }))
          return { code: 0, req_0: { code: 0, data: { tracks } } }
        },
      },
      { match: /search_for_qq_cp/, respond: () => loadFixture('qq/search-song.json') },
    ],
    { label: 'transfer' }
  )
  setRequestTransport(transport)
  state.config.qqCookie = 'uin=1; qm_keyst=K'
  state.config.uin = '1'
  state.playlists = []

  const m3uText = [
    '#EXTM3U',
    '#PLAYLIST:导入测试',
    '#EXTINF:269,周杰伦 - 晴天',
    'https://y.qq.com/n/ryqq/songDetail/m1',
    '#EXTINF:200,某歌手 - 未知歌',
    'bmp://local/%E6%9C%AA%E7%9F%A5%E6%AD%8C',
  ].join('\n')

  const p = importPlaylistText(m3uText, 'list.m3u')
  await new Promise((r) => setTimeout(r, 40))
  resolveConfirm(true)
  const res = await p
  log('导入 m3u：track info 补全 songId + 搜索补全无 mid + 创建加歌', res?.dirId === 9001 && res?.added === 2 && res?.skipped === 0, JSON.stringify(res))

  const createBody = parseMusicuBody(transport.calls.find((c) => parseMusicuBody(c.init)?.req_0?.method === 'AddPlaylist')?.init)
  const addBody = parseMusicuBody(transport.calls.find((c) => parseMusicuBody(c.init)?.req_0?.method === 'AddSonglist')?.init)
  log(
    '导入参数：歌单名 + v_songInfo 均为数字 songId',
    createBody?.req_0?.param?.dirName === '导入测试' &&
      addBody?.req_0?.param?.v_songInfo?.length === 2 &&
      addBody.req_0.param.v_songInfo.every((i) => Number(i.songId) > 0),
    JSON.stringify(addBody?.req_0?.param?.v_songInfo)
  )

  const before = transport.calls.length
  const p2 = importPlaylistText(m3uText, 'list.m3u')
  await new Promise((r) => setTimeout(r, 40))
  resolveConfirm(false)
  log('取消确认 → 不发起写请求', (await p2) === null && transport.calls.length === before)

  setRequestTransport(null)
  setFileBackend(null)
}

// ---------- 4a-29. 多账号切换（G3，运行时；网络全部 mock） ----------
console.log('\n=== 多账号切换（G3） ===')
{
  const { setRequestTransport } = await import('../src/core/http.js')
  const store = await import('../src/store/index.js')
  const { state, saveCurrentAccount, switchAccount, removeAccount, resolveConfirm, ACCOUNTS_MAX } = store
  const transport = createMockTransport([{ match: /./, respond: () => ({ code: 0, data: { disslist: [], cdlist: [] } }) }], { label: 'accounts' })
  setRequestTransport(transport)

  const useAccount = (uin, nickname) => {
    state.config.qqCookie = `uin=${uin}; qm_keyst=K${uin}`
    state.config.uin = String(uin)
    state.user = { uin: String(uin), nickname, avatar: '' }
  }

  state.accounts = []
  useAccount(11111, '账号A')
  const a = saveCurrentAccount()
  log(
    '保存当前账号（写入 bmp:accounts）',
    a?.id === '11111' && state.accounts.length === 1 && JSON.parse(globalThis.localStorage.getItem('bmp:accounts') || '[]')[0].cookie === 'uin=11111; qm_keyst=K11111'
  )

  useAccount(22222, '账号B')
  saveCurrentAccount()
  log('多账号：最新在前', state.accounts.length === 2 && state.accounts[0].id === '22222' && state.accounts[1].id === '11111')

  saveCurrentAccount()
  log('重复保存同一账号：去重', state.accounts.length === 2)

  for (let i = 0; i < 6; i++) {
    useAccount(30000 + i, `账号${i}`)
    saveCurrentAccount({ silent: true })
  }
  log(`账号上限 ${ACCOUNTS_MAX}`, state.accounts.length === ACCOUNTS_MAX)

  useAccount(11111, '账号A')
  saveCurrentAccount({ silent: true })
  useAccount(22222, '账号B')
  saveCurrentAccount({ silent: true })
  const p = switchAccount('11111')
  await new Promise((r) => setTimeout(r, 40))
  resolveConfirm(true)
  const ok = await p
  log(
    '切换账号：确认后写入目标 Cookie 并重载',
    ok === true && state.config.uin === '11111' && state.config.qqCookie.includes('qm_keyst=K11111'),
    JSON.stringify({ uin: state.config.uin, method: state.config.loginMethod })
  )
  log('切换前自动保存当前账号（B 仍在列表）', state.accounts.some((x) => x.id === '22222'))

  const before = state.config.uin
  const p2 = switchAccount('22222')
  await new Promise((r) => setTimeout(r, 40))
  resolveConfirm(false)
  log('取消切换：不改变当前账号', (await p2) === false && state.config.uin === before)

  const p3 = removeAccount('22222')
  await new Promise((r) => setTimeout(r, 40))
  resolveConfirm(true)
  log('删除已保存账号', (await p3) === true && !state.accounts.some((x) => x.id === '22222'))

  setRequestTransport(null)
}

// ---------- 4a-30. 主题（H1，运行时） ----------
console.log('\n=== 主题（运行时） ===')
{
  const { state, initTheme, setTheme, resolveTheme } = await import('../src/store/index.js')
  setTheme('light')
  log(
    'setTheme：持久化到 bmp:config',
    state.config.theme === 'light' && JSON.parse(globalThis.localStorage.getItem('bmp:config') || '{}').theme === 'light'
  )
  log('setTheme：非法值回退 system', setTheme('nope') === 'system' && state.config.theme === 'system')
  log('initTheme：启动应用（非浏览器环境不抛错）', initTheme() === 'dark' && state.config.theme === 'system')
  log('resolveTheme 在 store 层可用', resolveTheme('system', true) === 'light')
}

// ---------- 4a-31. 迷你播放器（H2，运行时；非原生环境） ----------
console.log('\n=== 迷你播放器（H2） ===')
{
  const { hasMiniPlayer } = await import('../src/core/mediaControl.js')
  const { toggleMiniPlayer, state } = await import('../src/store/index.js')
  log('Web/非原生环境：能力桥未注入', hasMiniPlayer() === false)
  const before = state.miniPlayer.enabled
  const r = await toggleMiniPlayer()
  log('非原生环境：开关 no-op（状态不变）', r === false && state.miniPlayer.enabled === before, JSON.stringify({ r, enabled: state.miniPlayer.enabled }))
}

// ---------- 4a-32. 收藏歌单读取（D3 修复，fixture + mock） ----------
console.log('\n=== 收藏歌单读取（D3 修复） ===')
{
  const { setRequestTransport } = await import('../src/core/http.js')
  const store = await import('../src/store/index.js')
  const { state, importUserPlaylists } = store

  // 1) 正常：musicu PlaylistFavRead 返回收藏列表；旧接口不应被调用
  let legacyCalled = false
  const transport = createMockTransport(
    [
      {
        match: /musicu\.fcg/,
        respond: (url, init) => {
          const body = parseMusicuBody(init)
          if (body?.req_0?.method === 'CgiGetPlaylistFavInfo') {
            return {
              code: 0,
              req_0: {
                code: 0,
                data: { total: 1, hasmore: 0, v_list: [{ tid: 7707261125, dirId: 31, name: '甜度爆表', logo: '', songnum: 66, nickname: 'u' }] },
              },
            }
          }
          return { code: 0, req_0: { code: 0, data: {} } }
        },
      },
      { match: /fcg_user_created_diss/, respond: () => loadFixture('qq/user-created-diss.json') },
      {
        match: /fcg_get_profile_order_asset/,
        respond: () => {
          legacyCalled = true
          return { code: 0, data: { cdlist: [] } }
        },
      },
    ],
    { label: 'favlist' }
  )
  setRequestTransport(transport)
  state.config.euin = 'euin-test'
  state.playlists = []
  await importUserPlaylists()
  log(
    '收藏歌单走 musicu PlaylistFavRead（不再依赖旧接口）',
    state.playlists.some((p) => p.kind === 'collected' && p.id === '7707261125' && p.name === '甜度爆表') && legacyCalled === false,
    JSON.stringify(state.playlists.map((p) => `${p.kind}:${p.id}`))
  )

  // 2) 回退：musicu 读取失败 → 旧接口兜底
  const fallback = createMockTransport(
    [
      { match: /musicu\.fcg/, respond: () => ({ code: 0, req_0: { code: 1000, msg: '拒绝' } }) },
      { match: /fcg_user_created_diss/, respond: () => loadFixture('qq/user-created-diss.json') },
      {
        match: /fcg_get_profile_order_asset/,
        respond: () => ({ code: 0, data: { cdlist: [{ dissid: 9001, dissname: '旧接口歌单', songnum: 3 }] } }),
      },
    ],
    { label: 'favlist-fallback' }
  )
  setRequestTransport(fallback)
  state.playlists = []
  await importUserPlaylists()
  log(
    '回退：musicu 失败时用旧接口兜底',
    state.playlists.some((p) => p.kind === 'collected' && p.id === '9001' && p.name === '旧接口歌单'),
    JSON.stringify(state.playlists.map((p) => `${p.kind}:${p.id}`))
  )
  setRequestTransport(null)
}

// ---------- 4a-33. 逐字歌词（QRC，fixture + mock） ----------
console.log('\n=== 逐字歌词（QRC） ===')
{
  const { setRequestTransport } = await import('../src/core/http.js')
  const { fetchLyric } = await import('../src/api/qq/lyric.js')
  const { parseQrc } = await import('../src/utils/qrc.js')
  const store = await import('../src/store/index.js')
  const { state, loadLyric, setLyricQrc, setLyricRoma } = store
  const fixture = loadFixture('qq/qrc-payload.json')

  const transport = createMockTransport(
    [
      {
        match: /musicu\.fcg/,
        respond: (url, init) => {
          const body = parseMusicuBody(init)
          if (body?.req_1?.param?.qrc === 1) {
            return { code: 0, req_1: { code: 0, data: { lyric: fixture.lyricHex, trans: '', roma: '' } } }
          }
          return { code: 0, req_1: { code: 0, data: { lyric: '', trans: '', roma: '' } } }
        },
      },
    ],
    { label: 'qrc' }
  )
  setRequestTransport(transport)

  const res = await fetchLyric(fixture.mid, '')
  log(
    'fetchLyric：QRC 加密载荷解密（qrc=true）',
    res.qrc === true && /LyricContent="/.test(res.lyric) && parseQrc(res.lyric).length === 11,
    JSON.stringify({ qrc: res.qrc, lines: parseQrc(res.lyric).length })
  )

  const song = { mid: 'QRCFIX1', id: 'QRCFIX1', name: '两只老虎', singers: [] }
  await loadLyric(song)
  const first = state.lyric.lines[0]
  log(
    'loadLyric：逐字行 + words 落库',
    state.lyric.qrc === true && state.lyric.lines.length === 11 && first.words.length === 18 && typeof first.words[0].time === 'number',
    JSON.stringify({ qrc: state.lyric.qrc, lines: state.lyric.lines.length, words: first.words?.length })
  )
  const cached = JSON.parse(globalThis.localStorage.getItem('bmp:lyric4:QRCFIX1') || '{}')
  log('缓存 v3 保存逐字标记与词', cached.qrc === true && cached.lines?.[0]?.words?.length === 18)

  log('显示开关默认值（逐字开 / 罗马音关）', state.config.lyricQrc === true && state.config.lyricRoma === false)
  setLyricRoma(true)
  setLyricQrc(false)
  const cfg = JSON.parse(globalThis.localStorage.getItem('bmp:config') || '{}')
  log('显示开关持久化到 bmp:config', cfg.lyricRoma === true && cfg.lyricQrc === false, JSON.stringify({ qrc: cfg.lyricQrc, roma: cfg.lyricRoma }))
  setLyricQrc(true)
  setLyricRoma(false)

  // 回退：QRC 解密失败（坏载荷）→ 明文 LRC + 翻译
  const fallback = createMockTransport(
    [
      {
        match: /musicu\.fcg/,
        respond: (url, init) => {
          const body = parseMusicuBody(init)
          if (body?.req_1?.param?.qrc === 1) return { code: 0, req_1: { code: 0, data: { lyric: '00'.repeat(64) } } }
          return loadFixture('qq/lyric-musicu.json')
        },
      },
    ],
    { label: 'qrc-fallback' }
  )
  setRequestTransport(fallback)
  state.lyric = { key: '', lines: [], loading: false, error: '', source: '', qrc: false }
  await loadLyric({ mid: 'QRCFIX2', id: 'QRCFIX2', name: '回退歌曲', singers: [] })
  log(
    '坏载荷回退明文 LRC（qrc=false + 翻译合并）',
    state.lyric.qrc === false && state.lyric.lines.length === 3 && state.lyric.lines[0].trans === 'First line',
    JSON.stringify({ qrc: state.lyric.qrc, lines: state.lyric.lines.length })
  )
  setRequestTransport(null)
}

// ---------- 4a-10. UI 偏好布尔持久化（默认歌词 / 桌面歌词） ----------
console.log('\n=== UI 偏好布尔持久化 ===')
{
  localStorage.setItem('bmp:lyric-view', 'false')
  localStorage.setItem('bmp:desktop-lyric', 'true')
  const fresh = await import(`../src/store/state.js?t=${Date.now()}-uipref`)
  log('默认歌词：false 能正确恢复（记住封面）', fresh.state.ui.showLyrics === false, String(fresh.state.ui.showLyrics))
  log('桌面歌词：true 能正确恢复（重启后自动恢复悬浮窗）', fresh.state.desktopLyric.enabled === true, String(fresh.state.desktopLyric.enabled))
  localStorage.setItem('bmp:lyric-view', 'true')
  localStorage.setItem('bmp:desktop-lyric', 'false')
  const fresh2 = await import(`../src/store/state.js?t=${Date.now()}-uipref2`)
  log('默认歌词：true 能正确恢复', fresh2.state.ui.showLyrics === true, String(fresh2.state.ui.showLyrics))
  log('桌面歌词：false 能正确恢复', fresh2.state.desktopLyric.enabled === false, String(fresh2.state.desktopLyric.enabled))
  localStorage.removeItem('bmp:lyric-view')
  localStorage.removeItem('bmp:desktop-lyric')
}

// ---------- 4b. 平台无关化架构守卫（阶段 3） ----------
console.log('\n=== 平台无关化架构守卫 ===')
{
  const up = readFileSync(new URL('../src/core/upstreams.js', import.meta.url), 'utf8')
  const cfg = readFileSync(new URL('../vite.config.js', import.meta.url), 'utf8')
  const img = readFileSync(new URL('../server/image-proxy.js', import.meta.url), 'utf8')
  const http = readFileSync(new URL('../src/core/http.js', import.meta.url), 'utf8')
  log('upstreams 是路由唯一事实来源（vite.config 由它生成代理）', /from '\.\/src\/core\/upstreams\.js'/.test(cfg) && /UPSTREAMS/.test(cfg))
  log('vite.config 不再硬编码上游域名', !/c\.y\.qq\.com|u\.y\.qq\.com|api\.bilibili\.com/.test(cfg))
  log('图片/音频白名单由 upstreams 统一提供', /from '\.\.\/src\/core\/upstreams\.js'/.test(img) && /IMAGE_HOST_ALLOW/.test(up) && /MEDIA_HOST_ALLOW/.test(up))
  log('upstreams 不含 Node 专有 API（可进浏览器包）', !/node:|require\(|process\./.test(up))
  log('http 适配层支持注入平台实现', /setHttpInterceptor/.test(http) && /setMediaResolvers/.test(http))
  log('api 层已改走适配层', /core\/http\.js/.test(readQqApiSource()) && /core\/http\.js/.test(readFileSync(new URL('../src/api/bilibili.js', import.meta.url), 'utf8')))
}

// ---------- 4c. 平台层守卫（阶段 4 前置：Capacitor 适配） ----------
console.log('\n=== 平台层守卫 ===')
{
  const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8')
  const coreHttp = read('../src/core/http.js')
  log('core 支持注入请求发送实现（移动端绕开 CORS）', /setRequestTransport/.test(coreHttp))
  log('core 支持注入媒体解析（图片/音频）', /setMediaResolvers/.test(coreHttp))
  {
    // 移动端 resolveAudioUrl 可能返回 Promise（先下载再播），bilibili 侧必须 await
    const bili = read('../src/api/bilibili.js')
    log('B站音源解析已 await（兼容移动端先下后播）', /await resolveAudioUrl\(/.test(bili))
  }

  const platform = read('../src/platform/index.js')
  log('平台适配仅在原生容器内激活', /isNativePlatform/.test(platform) && /import\('\.\/native\/index\.js'\)/.test(platform))

  const authApi = read('../src/api/auth.js')
  log('auth 支持平台后端分发', /setAuthBackend/.test(authApi) && /if \(backend\)/.test(authApi))

  const cache = read('../src/utils/mediaCache.js')
  log('图片解析支持异步注入', /setImageResolver/.test(cache) && /useImage/.test(cache))

  const appImage = read('../src/components/AppImage.vue')
  log('存在异步图片组件', /useImage/.test(appImage))

  const nativeFiles = ['../src/platform/native/http.js', '../src/platform/native/media.js', '../src/platform/native/auth.js']
  log('原生适配层按依赖注入拆分（可单测）', nativeFiles.every((f) => /export function create/.test(read(f))))

  log('平台层单测脚本存在', existsSync(new URL('../scripts/platform-test.mjs', import.meta.url)))
}

// ---------- 4d. Android 打包配置守卫 ----------
console.log('\n=== Android 打包配置守卫 ===')
{
  const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8')
  const capPath = new URL('../capacitor.config.json', import.meta.url)
  log('capacitor.config.json 存在', existsSync(capPath))
  const cap = JSON.parse(readFileSync(capPath, 'utf8'))
  log('appId 合法且与约定一致', cap.appId === 'com.bilimusic.player', cap.appId)
  log('webDir 指向 vite 产物 dist', cap.webDir === 'dist', cap.webDir)
  log('未开启全局 fetch patch（只用显式原生 transport）', cap.plugins?.CapacitorHttp?.enabled !== true)

  const pkg = JSON.parse(read('../package.json'))
  log(
    'npm scripts 含 Android 构建链路',
    ['build:android', 'cap:sync', 'cap:add:android', 'cap:open', 'cap:run'].every((s) => pkg.scripts[s])
  )
  log('Capacitor 依赖已声明', Boolean(pkg.dependencies['@capacitor/core'] && pkg.devDependencies['@capacitor/cli']))

  const vite = read('../vite.config.js')
  log('capacitor 模式使用相对资源路径', /base:\s*capacitor\s*\?\s*'\.\/'/.test(vite))
  log('capacitor 模式不注册本地中间件', /plugins:\s*capacitor\s*\?\s*\[vue\(\)\]/.test(vite))

  const manifest = read('../android/app/src/main/AndroidManifest.xml')
  log('AndroidManifest 声明 INTERNET 权限', /android\.permission\.INTERNET/.test(manifest))

  const vars = read('../android/variables.gradle')
  log('minSdk 24 / compileSdk 36（Capacitor 8 要求）', /minSdkVersion = 24/.test(vars) && /compileSdkVersion = 36/.test(vars))
}

// ---------- 4e. 网页登录（内嵌 QQ 登录页取 Cookie）守卫 ----------
console.log('\n=== 网页登录守卫 ===')
{
  const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8')
  const javaDir = '../android/app/src/main/java/com/bilimusic/player'

  const plugin = read(`${javaDir}/QqWebLoginPlugin.java`)
  log('原生插件已定义', /@CapacitorPlugin\(name = "QqWebLogin"\)/.test(plugin))
  log('插件提供 open/clear 两个方法', /public void open\(PluginCall/.test(plugin) && /public void clear\(PluginCall/.test(plugin))
  log('插件用 ActivityCallback 回传结果', /@ActivityCallback/.test(plugin) && /startActivityForResult\(/.test(plugin))

  const activity = read(`${javaDir}/QqLoginActivity.java`)
  log('登录页读取 WebView Cookie', /CookieManager\.getInstance\(\)/.test(activity) && /\.getCookie\(/.test(activity))
  log('以 qm_keyst/qqmusic_key 判定登录完成', /qm_keyst=/.test(activity) && /qqmusic_key=/.test(activity))
  log('处理登录弹窗（onCreateWindow）', /onCreateWindow/.test(activity))
  log(
    '按多域名合并读取 Cookie（实测票据在 .ptlogin2.qq.com 域下）',
    /COOKIE_URLS/.test(activity) && /ptlogin2\.qq\.com/.test(activity) && /y\.qq\.com/.test(activity)
  )
  log('记录导航轨迹并挑出登录跳板 URL', /recordNav/.test(activity) && /check_sig/.test(activity) && /navLog/.test(activity))
  log('非 http(s) scheme 交给系统处理（避免静默卡住）', /Intent\.ACTION_VIEW/.test(activity))
  log('回传诊断字段（cookieNames/navLog/jumpUrl）', /EXTRA_COOKIE_NAMES/.test(activity) && /EXTRA_NAV_LOG/.test(activity) && /EXTRA_JUMP_URL/.test(activity))

  const main = read(`${javaDir}/MainActivity.java`)
  log('MainActivity 已注册插件', /registerPlugin\(QqWebLoginPlugin\.class\)/.test(main))

  const manifest = read('../android/app/src/main/AndroidManifest.xml')
  log('清单声明了登录页 Activity', /android:name="\.QqLoginActivity"/.test(manifest))

  const dialog = read('../src/components/LoginDialog.vue')
  log('登录弹窗支持多方式切换', /login-tabs/.test(dialog) && /扫码登录/.test(dialog) && /网页登录/.test(dialog) && /手动 Cookie/.test(dialog))
  log('网页登录入口受平台能力控制', /supportsWebLogin/.test(dialog) && /webLoginPage/.test(dialog))
  log(
    '未拿到 qm_keyst 时拒绝建立登录态（避免半登录）',
    /if \(!r\.hasMusicKey\)/.test(dialog) && /throw new Error\(\s*'未检测到 QQ 音乐登录票据/.test(dialog)
  )
  log('网页登录失败时展示诊断', /webDiag/.test(dialog))
  log(
    '手动 Cookie 支持剪贴板导入与书签小工具',
    /pasteFromClipboard/.test(dialog) && /copyBookmarklet/.test(dialog) && /从剪贴板粘贴/.test(dialog)
  )
  log('Cookie 登录前校验关键项', /cookieHasLogin/.test(dialog))
  log('书签小工具代码始终可见（剪贴板不可用时手动复制）', /bm-code/.test(dialog) && /bookmarklet/.test(dialog))
  log(
    '回到应用/切到该页时自动拾取剪贴板 Cookie',
    /autoPickClipboard/.test(dialog) && /visibilitychange/.test(dialog) && /readClipboard/.test(dialog)
  )
  log(
    '扫码轮询自动重试（网络抖动不再一错即停）',
    /POLL_RETRY_MAX/.test(dialog) && /pollRetryMessage/.test(dialog) && /handlePollFailure/.test(dialog)
  )
  log('二维码生成失败自动重试（带退避）', /START_RETRY_MAX/.test(dialog) && /startRetryDelay/.test(dialog))
  log('回到前台补扫码轮询（被冻结后不再有空窗）', /resumeQrPolling/.test(dialog) && /onVisibilityChange/.test(dialog))
  log('英文报错友好化（不再原样直出）', /friendlyLoginError/.test(dialog) && /from '\.\.\/utils\/loginRetry'/.test(dialog))
  log(
    '登录重试策略为平台无关纯函数（可单测）',
    existsSync(new URL('../src/utils/loginRetry.js', import.meta.url))
  )
  log(
    '剪贴板读写走平台封装（core 定接口、platform 注入原生实现）',
    existsSync(new URL('../src/core/clipboard.js', import.meta.url)) &&
      existsSync(new URL('../src/platform/native/clipboard.js', import.meta.url)) &&
      /setClipboard/.test(read('../src/platform/native/index.js'))
  )
  {
    const pkg = JSON.parse(read('../package.json'))
    log('已声明 @capacitor/clipboard 依赖', Boolean(pkg.dependencies['@capacitor/clipboard']))
    const settings = read('../android/capacitor.settings.gradle')
    log('Android 工程已注册 clipboard 插件', /capacitor-clipboard/.test(settings))
  }
  log('存在 Cookie 导入工具模块', existsSync(new URL('../src/utils/cookieImport.js', import.meta.url)))

  const authApi = read('../src/api/auth.js')
  log('auth 暴露网页登录接口', /export function supportsWebLogin/.test(authApi) && /export async function webLoginPage/.test(authApi))

  {
    // 实测：网页登录入口 = 普通登录页(xlogin) + s_url 指向 OAuth authorize
    // 用 login_jump 会停在空页面；直接进 authorize 会落到依赖本机 QQ 客户端的一键登录页
    const loginDialog = read('../src/components/LoginDialog.vue')
  log('正式构建禁用网页登录实验参数', /allowOneKey:\s*showExperimental\s*&&\s*Boolean\(state\.config\.webLoginOneKey\)/.test(loginDialog))

  const webLoginJs = read('../src/platform/native/qqWebLogin.js')
    const coreLogin = read('../src/core/qqLogin.js')
    log('网页登录入口使用 webLoginUrl()', /webLoginUrl\(\)/.test(webLoginJs) && !/xloginUrl\(\)/.test(webLoginJs))
    log(
      'core 导出 webLoginUrl = xlogin + s_url=authorize',
      /export function webLoginUrl/.test(coreLogin) && /return xloginUrl\(authorizeUrl\(\)/.test(coreLogin)
    )
    log('core 记录了两个坑（login_jump 空页 / PC 一键登录变体）', /login_jump/.test(coreLogin) && /sdkp=pcweb/.test(coreLogin))
    log('xloginUrl 仍保留给扫码流程（默认 u1=login_jump）', /export function xloginUrl\(sUrl = U1/.test(coreLogin))
    log('登录页不覆盖 UA（避免落到不可用的页面变体）', !/userAgent:\s*USER_AGENT/.test(webLoginJs))
  }

  const store = readStoreSource()
  log('退出登录会清理网页登录 Cookie', /clearWebLoginCookies/.test(store) && /export async function logout/.test(store))
  log(
    '诊断报告包含登录方式与 Cookie 名单',
    /loginMethod/.test(store) && /cookieNamesHint/.test(store) && /Cookie 项目/.test(store)
  )
  log(
    '登录方式随 config 持久化（重启后诊断不再误报「未知」红点）',
    /loginMethod:\s*''/.test(store) &&
      /state\.loginMethod\s*=\s*state\.config\.loginMethod/.test(store) &&
      /loginMethod:\s*state\.loginMethod/.test(store) &&
      /state\.loginMethod\s*=\s*''/.test(store),
  )

  const nativeIndex = read('../src/platform/native/index.js')
  log('原生层注册了 QqWebLogin 插件', /registerPlugin\('QqWebLogin'\)/.test(nativeIndex) && /setWebLogin/.test(nativeIndex))
}

// ---------- 4f. 播放音源策略守卫（默认 B 站 / 单曲可切换 / 未匹配自动匹配） ----------
console.log('\n=== 播放音源策略守卫 ===')
{
  const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8')
  const store = readStoreSource()

  log('默认音源为 B 站', /defaultSource:\s*'bili'/.test(store))
  log('单曲音源偏好会持久化', /bmp:source-pref/.test(store) && /persistSourcePref/.test(store))
  log('sourceFor：单曲覆盖优先于全局默认', /export function sourceFor/.test(store) && /state\.sourcePref\[songKey\(song\)\] \|\| state\.config\.defaultSource/.test(store))
  log('只有用户选了 QQ 才优先走 QQ 直链', /if \(sourceFor\(song\) === 'qq'\)/.test(store))

  // playIndex 负责把歌单行映射到队列项；startPlayback 内：B 站分支在 QQ 分支之后、默认走 playFromBili
  const playIdx = store.slice(store.indexOf('export async function playIndex'), store.indexOf('export function togglePlay'))
  log('歌单行播放会映射到队列项', /state\.player\.queueIndex = qi/.test(playIdx) && /await startPlayback\(song, index, seq\)/.test(playIdx))
  log('默认走 B 站分支', /await playFromBili\(song, rowIndex, seq\)/.test(store))
  log('B 站优先时会先自动匹配', /async function playFromBili[\s\S]{0,400}ensureMatch\(song\)/.test(store))
  log('匹配不到不自动回退 QQ（提示并等用户选择）', /未匹配到 B 站音源/.test(store) && /可点「搜索并选择」手动匹配/.test(store))
  log('播放中有明确的加载文案', /loadingText/.test(store) && /正在匹配 B 站音源/.test(store))
  log('可就地切换音源并重播', /export async function switchCurrentSource/.test(store) && /export async function useSource/.test(store))

  const bar = read('../src/components/PlayerBar.vue')
  log('播放条提供音源切换按钮', /switchCurrentSource/.test(bar) && /src-btn/.test(bar))
  const np = read('../src/components/NowPlaying.vue')
  log('全屏播放器提供音源切换按钮', /switchCurrentSource/.test(np) && /np-act/.test(np))
  log(
    '播放键以队列为准（重启恢复队列后可开播）',
    /:disabled="!state\.queue\.length"/.test(bar) && /class="ctrl np-play" :disabled="!state\.queue\.length"/.test(np)
  )

  const settings = read('../src/components/SettingsDialog.vue')
  log('设置里可选默认音源', /默认播放音源/.test(settings) && /defaultSource/.test(settings))
  const viteRelease = read('../vite.config.js')
  log('正式构建注入 release 标志', /__APP_RELEASE__/.test(viteRelease) && /mode === 'production'/.test(viteRelease) && /mode === 'capacitor'/.test(viteRelease))
  log('正式构建隐藏实验入口与构建调试提示', /showExperimental\s*=\s*SHOW_EXPERIMENTAL\s*&&\s*!isRelease/.test(settings) && /v-if="showExperimental"/.test(settings) && /v-if="!isRelease"/.test(settings) && /buildTime/.test(settings))
  log('设置里有「一键登录」实验开关', /webLoginOneKey/.test(settings) && /一键登录/.test(settings))

  const webLoginJs = read('../src/platform/native/qqWebLogin.js')
  log('网页登录支持一键登录实验开关', /allowOneKey/.test(webLoginJs))

  const act = read('../android/app/src/main/java/com/bilimusic/player/QqLoginActivity.java')
  log('原生侧开启实验后不自动返回', /EXTRA_ALLOW_ONE_KEY/.test(act) && /if \(allowOneKey\) return false/.test(act))
}

// ---------- 5. 开源规范化守卫 ----------
console.log('\n=== 开源规范化守卫 ===')
const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8')
{
  const store = readStoreSource()
  log('存储键前缀已改为 bmp:', /bmp:config/.test(store) && !/qqbili:/.test(store))

  const html = read('../index.html')
  log('index.html 标题中性化', /bili-music-player/.test(html) && !/哔哩哔哩\s*播放器/.test(html))

  const side = read('../src/components/Sidebar.vue')
  log('侧栏品牌中性化', /bili-music-player/.test(side) && !/QQ音乐 ×/.test(side))

  const diag = read('../src/components/DiagnosticsDialog.vue')
  log('诊断报告头中性化', /bili-music-player 诊断报告/.test(diag) && !/QQ音乐 ×/.test(diag))
  log(
    '诊断报告复制前隐藏地址参数、Cookie 与账号编号',
    /页面来源：本地应用/.test(diag) &&
      /scrubSensitiveText/.test(diag) &&
      /\[已隐藏\]/.test(diag) &&
      !/location\.href|location\.origin/.test(diag) &&
      !/state\.config\.uin/.test(diag) &&
      !/state\.config\.qqCookie \|\| ''\)\.length/.test(diag)
  )

  const vite = read('../vite.config.js')
  log(
    '默认绑定 127.0.0.1（仅 BMP_LAN 时开局域网）',
    /host:\s*LAN_MODE\s*\?\s*true\s*:\s*'127\.0\.0\.1'/.test(vite)
  )
  log('访问守卫已注册且在代理之前', /middlewares\.use\(guard\)/.test(vite))

  const server = read('../server/qq-login.js')
  log('服务端日志默认关闭(QQ_DEBUG)', /QQ_DEBUG/.test(server) && /if \(!DEBUG\) return/.test(server))

  const pkg = JSON.parse(read('../package.json'))
  log('package.json 名称/许可/引擎', pkg.name === 'bili-music-player' && pkg.license === 'MIT' && /20/.test(pkg.engines?.node))

  log('LICENSE 存在且为 MIT', existsSync(new URL('../LICENSE', import.meta.url)) && /MIT License/.test(read('../LICENSE')))
  log('README 含非官方声明', /非官方/.test(read('../README.md')))
  {
    const sec = read('../SECURITY.md')
    log('SECURITY 说明禁止公网部署', /部署到公网/.test(sec) && /开放代理/.test(sec))
    log('SECURITY 说明局域网模式与口令', /局域网模式/.test(sec) && /访问口令/.test(sec))
    log('SECURITY 含 Clash/代理软件注意事项', /Clash/.test(sec) && /IP 绑定|IP 绑定 token|绑定 token/.test(sec))
  }

  // start.bat：必须是 GBK（不能被转成 UTF-8 BOM / UTF-8）
  const batPath = new URL('../start.bat', import.meta.url)
  log('start.bat 存在', existsSync(batPath))
  const bat = readFileSync(batPath)
  log('start.bat 非 UTF-8 BOM（保留 GBK）', !(bat[0] === 0xef && bat[1] === 0xbb && bat[2] === 0xbf) && bat[0] === 0x40)
  log('旧文件名 启动.bat 已移除', !existsSync(new URL('../启动.bat', import.meta.url)))
}

// ---------- 6. 无敏感信息 ----------
console.log('\n=== 敏感信息扫描 ===')
{
  const storeFiles = readdirSync(new URL('../src/store/', import.meta.url))
    .filter((f) => f.endsWith('.js'))
    .map((f) => `../src/store/${f}`)
  const qqFiles = readdirSync(new URL('../src/api/qq/', import.meta.url))
    .filter((f) => f.endsWith('.js'))
    .map((f) => `../src/api/qq/${f}`)
  const files = [
    ...storeFiles,
    '../src/api/qq.js',
    ...qqFiles,
    '../src/core/upstreams.js',
    '../src/core/http.js',
    '../vite.config.js',
    '../server/qq-login.js',
    '../server/image-proxy.js',
    '../scripts/e2e-test.mjs',
    '../README.md',
  ]
  const bad = []
  for (const f of files) {
    const t = read(f)
    // 测试脚本里会出现合成的示例值（如 'qm_keyst=abc'），只对非测试文件做“疑似真实密钥值”判断
    const isTest = /scripts\//.test(f)
    if (!isTest && /qm_keyst\s*=\s*[A-Za-z0-9]{6,}/.test(t)) bad.push(`${f}: 疑似写入 qm_keyst 值`)
    if (!isTest && /SESSDATA\s*=\s*[A-Za-z0-9%]{6,}/.test(t)) bad.push(`${f}: 疑似写入 SESSDATA`)
    if (/[A-Za-z]:\\\\Users\\\\/.test(t) || /E:\\\\git_project/.test(t)) bad.push(`${f}: 含本机绝对路径`)
    if (/ghp_[A-Za-z0-9]{20,}/.test(t)) bad.push(`${f}: 含 GitHub token`)
  }
  log('源码中不含 Cookie/token/个人绝对路径', bad.length === 0, bad.join(' | '))
}

console.log(`\n===== 结果：PASS ${pass} / FAIL ${fail} =====`)
process.exit(fail ? 1 : 0)
