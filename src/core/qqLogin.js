/**
 * QQ 扫码登录核心（平台无关）。
 *
 * 只依赖 Web 标准 API（URL / URLSearchParams / Map / FormData / TextDecoder），
 * 通过注入的 `transport` 发请求，因此 Web（Node 中间件）与移动端（Capacitor 原生 HTTP）
 * 可以共用同一套流程。
 *
 * transport 接口（与 fetch 对齐，需支持手动跟随 302）：
 *   transport({ url, method, headers, body, timeout }) →
 *     { status, ok, headers: { get(name), getSetCookie?() }, text(), arrayBuffer() }
 *
 * 注意：浏览器 fetch 无法读取 Set-Cookie（forbidden header），因此移动端必须提供
 * 原生实现；这套核心只负责解析结果、维护 Cookie jar 与流程编排。
 */
import { USER_AGENT } from './upstreams.js'

export const APPID = '716027609'
export const PT_3RD_AID = '100497308'
export const DAID = '383'
// 经实测，u1 只接受 QQ 互联的登录跳板；最终音乐侧的票据靠后续 code 兑换获得
export const U1 = 'https://graph.qq.com/oauth2.0/login_jump'
export const CLIENT_ID = '100497308'
export const REDIRECT_URI =
  'https://y.qq.com/portal/wx_redirect.html?login_type=1&surl=https://y.qq.com/'
// 新版接口在 xui.ptlogin2.qq.com/ssl 下（旧 ssl.ptlogin2.qq.com 对本 appid 会 403）
export const XLOGIN = 'https://xui.ptlogin2.qq.com/cgi-bin/xlogin'
export const QR_SHOW = 'https://xui.ptlogin2.qq.com/ssl/ptqrshow'
export const QR_LOGIN = 'https://xui.ptlogin2.qq.com/ssl/ptqrlogin'
export const SESSION_TTL = 10 * 60 * 1000

// 登录流程会手动跟随腾讯返回的 302；只允许 HTTPS 的 QQ 域名，避免把登录 Cookie 带到任意跳板。
export function isAllowedLoginUrl(raw) {
  try {
    const url = new URL(String(raw || ''))
    return url.protocol === 'https:' && /(^|\.)qq\.com$/i.test(url.hostname)
  } catch {
    return false
  }
}
/** 腾讯 hash33；ptqrtoken 初值 0，g_tk 初值 5381 */
function hashLike(str, seed) {
  let e = seed
  for (let i = 0; i < str.length; i++) e += (e << 5) + str.charCodeAt(i)
  return e & 2147483647
}
export function hash33(str) {
  return hashLike(str, 0)
}
export function getGtk(pSkey) {
  return hashLike(pSkey, 5381)
}

function guid() {
  let out = ''
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) out += '-'
    else if (i === 14) out += '4'
    else {
      const r = (Math.random() * 16) | 0
      out += (i === 19 ? (r & 0x3) | 0x8 : r).toString(16)
    }
  }
  return out.toUpperCase()
}

/** 会话 id：优先用平台安全随机数，退化到 guid */
export function randomId() {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  return guid()
}

export function cookieString(jar) {
  return Array.from(jar.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join('; ')
}

/** Cookie 字符串 → Map（忽略空项与空名） */
export function parseCookieString(text) {
  const jar = new Map()
  for (const part of String(text || '').split(';')) {
    const p = part.trim()
    if (!p) continue
    const i = p.indexOf('=')
    if (i <= 0) continue
    const name = p.slice(0, i).trim()
    if (!name) continue
    jar.set(name, p.slice(i + 1).trim())
  }
  return jar
}

/**
 * 取响应里的 Set-Cookie 列表。
 * Node(undici) 有 getSetCookie()；没有时退化为按逗号切分（仅用于简单场景）。
 */
export function setCookieList(headers) {
  if (!headers) return []
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie()
  const raw = headers.get('set-cookie') || headers.get('Set-Cookie')
  if (!raw) return []
  return splitSetCookie(raw)
}

/** 把一条（或逗号拼接的）Set-Cookie 字符串切成多条 */
export function splitSetCookie(raw) {
  return String(raw)
    .split(/,(?=\s*[A-Za-z0-9_\-.#]+=)/)
    .map((s) => s.trim())
    .filter(Boolean)
}

export function storeCookies(jar, headers, extraJar) {
  for (const item of setCookieList(headers)) {
    const pair = String(item).split(';')[0]
    const i = pair.indexOf('=')
    if (i <= 0) continue
    const name = pair.slice(0, i).trim()
    const value = pair.slice(i + 1).trim()
    if (!name) continue
    jar.set(name, value)
    if (extraJar) extraJar.set(name, value)
  }
}

export function extractUin(jar) {
  const raw = jar.get('uin') || jar.get('pt2gguin') || jar.get('superuin') || jar.get('wxuin') || ''
  const m = String(raw).match(/(\d{5,})/)
  return m ? m[1] : ''
}

export function cookieSummary(jar) {
  return Array.from(jar.entries()).map(([name, value]) => ({
    name,
    len: String(value || '').length,
    empty: !value,
  }))
}

/** 解析 ptuiCB('code','...','redirectUrl','...','message','nickname') */
export function parsePtuiCB(text) {
  const args = [...String(text).matchAll(/'([^']*)'/g)].map((m) => m[1])
  return { code: args[0], redirectUrl: args[2], message: args[4] || '', nickname: args[5] || '' }
}

export function xloginUrl(sUrl = U1, style = '33') {
  const url = new URL(XLOGIN)
  url.search = new URLSearchParams({
    appid: APPID,
    daid: DAID,
    style,
    login_text: '登录',
    hide_title_bar: '1',
    hide_border: '1',
    target: 'self',
    s_url: sUrl,
    pt_3rd_aid: PT_3RD_AID,
    pt_feedback_link: `https://support.qq.com/products/77942?customInfo=.appid${PT_3RD_AID}`,
  }).toString()
  return url.href
}

/**
 * 浏览器 / WebView「网页登录」的入口。
 *
 * ⚠️ 实测（2026-09）三个坑：
 *  1) 不能直接用 xlogin 的默认 s_url=login_jump —— 登录成功后 ptlogin 跳到
 *     graph.qq.com/oauth2.0/login_jump，该地址对网页请求返回 **200 空页面**，流程断死
 *     （真机表现为「登录完成后没有自动跳转」）。
 *  2) 也不能直接进 graph.qq.com/oauth2.0/authorize —— 会被领到
 *     「PC 网页一键登录」变体页（style=35&sdkp=pcweb），该页依赖本机 QQ 客户端。
 *  3) style=35（移动版）同样不可用：它带 s_url=authorize 会立刻跳到上面那个
 *     一键登录页，而且该页 **没有可用的密码表单**（#q_login 内无输入框，调用页面自带的
 *     pt.switchpwd() 也不会显示表单）。也就是说腾讯给第三方网页登录只提供了
 *     style=33 这个（桌面式）页面，但它同时提供二维码与密码登录，是唯一可用的入口。
 *
 * 正确做法：style=33 + s_url=<authorize>，登录页会正常渲染二维码/密码登录；
 * 移动端由 QqLoginActivity 自动切到「密码登录」表单（单机用户扫不了自己屏幕上的二维码）。
 *   xlogin(style=33) → 登录成功 → s_url=<authorize>
 *   → authorize（带会话）→ 302 到 redirect_uri 带 code
 *   → y.qq.com/portal/wx_redirect.html → 页面 JS 调 musicu 兑换出 qm_keyst
 *
 * 扫码登录（startLogin）也用 style=33 + u1=login_jump，那是 ptlogin 二维码接口所需。
 */
export function webLoginUrl({ mobile = false } = {}) {
  return xloginUrl(authorizeUrl(), mobile ? '35' : '33')
}

/**
 * 浏览器 / WebView「网页登录」的入口：QQ 互联 OAuth 授权地址。
 *
 * ⚠️ 实测（2026-09）：**不能用 xlogin + s_url=login_jump 作为网页登录入口** ——
 * 登录成功后 ptlogin 会跳到 graph.qq.com/oauth2.0/login_jump，而该地址对网页请求
 * 直接返回 **200 空页面**，流程就断在那里（表现为「登录完成后没有自动跳转」）。
 *
 * 从 authorize 进入才是正规网页流程：
 *   authorize → ptlogin 授权页（扫码/密码/一键登录）→ 授权后带 code 跳回
 *   redirect_uri（y.qq.com/portal/wx_redirect.html）→ 页面 JS 调 musicu 兑换出 qm_keyst
 *
 * 扫码登录（QQLogin 的 startLogin）仍使用 xlogin + u1=login_jump，那是 ptlogin 的
 * 二维码接口所需，与网页登录无关。
 */
export function authorizeUrl() {
  const url = new URL('https://graph.qq.com/oauth2.0/authorize')
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: 'get_user_info,get_app_friends',
    state: 'state',
    from_ptlogin: '1',
  }).toString()
  return url.href
}

export function qrShowUrl() {  const qr = new URL(QR_SHOW)
  qr.search = new URLSearchParams({
    appid: APPID,
    e: '2',
    l: 'M',
    s: '3',
    d: '72',
    v: '4',
    t: String(Math.random()),
    daid: DAID,
    pt_3rd_aid: PT_3RD_AID,
    u1: U1,
  }).toString()
  return qr.href
}

export function qrLoginUrl(session) {
  const url = new URL(QR_LOGIN)
  url.search = new URLSearchParams({
    u1: U1,
    ptqrtoken: String(hash33(session.qrsig)),
    ptredirect: '0',
    h: '1',
    t: '1',
    g: '1',
    from_ui: '1',
    ptlang: '2052',
    action: `0-0-${Date.now()}`,
    js_ver: '23111510',
    js_type: '1',
    login_sig: session.jar.get('pt_login_sig') || '',
    pt_uistyle: '40',
    aid: APPID,
    daid: DAID,
    pt_3rd_aid: PT_3RD_AID,
    // 注意：不要带 has_onekey，否则会走「一键登录」上下文，可能被下发 p_skey_forbid
  }).toString()
  return url.href
}

function withParams(base, params) {
  const url = new URL(base)
  url.search = new URLSearchParams(params).toString()
  return url.href
}

export function profileUrl(uin) {
  return withParams('https://c.y.qq.com/rsc/fcgi-bin/fcg_get_profile_homepage.fcg', {
    ct: '20',
    cid: '205360838',
    userid: uin,
    reqfrom: '1',
    reqtype: '0',
    g_tk: '5381',
    loginUin: uin,
    hostUin: '0',
    format: 'json',
    inCharset: 'utf8',
    outCharset: 'utf-8',
    notice: '0',
    platform: 'yqq.json',
    needNewCode: '0',
  })
}

export function collectedUrl(uin) {
  return withParams('https://c.y.qq.com/fav/fcgi-bin/fcg_get_profile_order_asset.fcg', {
    ct: '20',
    cid: '205360956',
    userid: uin,
    reqfrom: '1',
    reqtype: '2',
    sin: '0',
    ein: '1',
    g_tk: '5381',
    loginUin: uin,
    hostUin: '0',
    format: 'json',
    inCharset: 'utf8',
    outCharset: 'utf-8',
    notice: '0',
    platform: 'yqq.json',
    needNewCode: '0',
  })
}

export function createdUrl(uin) {
  return withParams('https://c.y.qq.com/rsc/fcgi-bin/fcg_user_created_diss', {
    hostuin: uin,
    size: '10',
    handlet: '2',
    format: 'json',
    inCharset: 'utf8',
    outCharset: 'utf-8',
    notice: '0',
    platform: 'yqq.json',
    needNewCode: '1',
  })
}

/**
 * 创建一套登录流程。
 * @param {object} opts
 * @param {Function} opts.transport  平台请求实现（见文件头注释）
 * @param {Function} [opts.log]      (step, data) => void，默认不输出
 */
export function createQqLogin({ transport, log = () => {} } = {}) {
  if (typeof transport !== 'function') throw new Error('createQqLogin 需要 transport')

  const sessions = new Map()
  const logStep = (step, data) => {
    try {
      log(step, data)
    } catch {
      /* ignore */
    }
  }

  /** 带 Cookie jar 的请求：自动带上 jar、收集 Set-Cookie */
  async function reqJar(jar, url, opts = {}) {
    const {
      method = 'GET',
      referer,
      body,
      contentType,
      timeout = 15000,
      extraHeaders = {},
      extraJar,
      cookieOverride,
    } = opts
    const headers = {
      'User-Agent': USER_AGENT,
      Accept: '*/*',
      ...(referer ? { Referer: referer } : {}),
      ...extraHeaders,
      Cookie: cookieOverride !== undefined ? cookieOverride : cookieString(jar),
    }
    const isForm = typeof FormData !== 'undefined' && body instanceof FormData
    // FormData 需要由底层库自动生成带 boundary 的 Content-Type
    if (contentType && !isForm) headers['Content-Type'] = contentType
    const res = await transport({ url, method, redirect: 'manual', headers, body, timeout })
    storeCookies(jar, res.headers, extraJar)
    return res
  }

  async function getJson(jar, url, referer) {
    const res = await reqJar(jar, url, { referer })
    const text = await res.text()
    let data = null
    try {
      data = JSON.parse(text)
    } catch {
      data = null
    }
    return {
      httpStatus: res.status,
      code: data?.code,
      subcode: data?.subcode,
      msg: data?.msg || data?.message || '',
      data,
      raw: text.slice(0, 200),
    }
  }

  const profileJson = (jar, uin) => getJson(jar, profileUrl(uin), 'https://y.qq.com/portal/profile.html')
  const collectedJson = (jar, uin) => getJson(jar, collectedUrl(uin), 'https://y.qq.com/portal/profile.html')
  const createdJson = (jar, uin) => getJson(jar, createdUrl(uin), 'https://y.qq.com/portal/profile.html')

  async function fetchProfile(jar, uin) {
    const r = await profileJson(jar, uin)
    if (r.code !== 0) return null
    const c = r.data?.data?.creator || r.data?.data || {}
    return {
      nickname: c.nick || c.nickname || '',
      avatar: c.headpic || c.headurl || '',
      vip: Number(c.vip || r.data?.data?.vip?.viptype || 0) || 0,
    }
  }

  /** 逐一探测旧版接口，用于判断会话到底能走到哪一步 */
  async function probeLegacy(jar, uin, diag) {
    const out = {}
    if (!uin) {
      if (diag) diag.legacy = { note: '未解析到 uin' }
      return out
    }
    try {
      const r = await profileJson(jar, uin)
      out.profileCode = r.code
      out.profileMsg = r.msg
    } catch (e) {
      out.profileCode = `ERR:${e.message}`
    }
    try {
      const r = await collectedJson(jar, uin)
      out.collectedCode = r.code
      out.collectedMsg = r.msg
    } catch (e) {
      out.collectedCode = `ERR:${e.message}`
    }
    try {
      const r = await createdJson(jar, uin)
      out.createdCode = r.code
      out.createdCount = (r.data?.data?.disslist || []).length
    } catch (e) {
      out.createdCode = `ERR:${e.message}`
    }
    if (diag) diag.legacy = out
    return out
  }

  /** 扫码确认后：check_sig 取 p_skey → authorize 取 code → musicu 换音乐票据 */
  async function completeCredential(jar, checkSigUrl, diag = {}) {
    diag.checkSigHops = []
    diag.cookiesAfterPoll = cookieSummary(jar)

    // check_sig 可能有多级 302，p_skey 可能在中途任一跳下发，因此逐跳跟随并收集
    let url = checkSigUrl
    if (!isAllowedLoginUrl(url)) throw new Error('登录跳转地址不受信任，已中止登录')
    for (let i = 0; i < 8 && url; i++) {
      const res = await reqJar(jar, url)
      const names = setCookieList(res.headers)
        .map((c) => String(c).split('=')[0].trim())
        .filter(Boolean)
      const loc = res.headers.get('location')
      let host = url
      try {
        host = new URL(url).host
      } catch {
        /* keep raw */
      }
      diag.checkSigHops.push({
        i,
        host,
        status: res.status,
        location: (loc || '').slice(0, 300),
        setCookie: names,
      })
      logStep('check_sig', `#${i} ${url}`)
      logStep('check_sig resp', `status=${res.status} location=${loc || '-'} set-cookie=${names.join(',') || '-'}`)
      if (jar.get('p_skey')) break
      if (res.status >= 300 && res.status < 400 && loc) {
        const nextUrl = new URL(loc, url).href
        if (!isAllowedLoginUrl(nextUrl)) throw new Error('登录跳转地址不受信任，已中止登录')
        url = nextUrl
      } else {
        break
      }
    }

    diag.cookiesAfterCheckSig = cookieSummary(jar)
    diag.pSkey = { present: jar.has('p_skey'), len: (jar.get('p_skey') || '').length }
    diag.pSkeyForbid = jar.get('p_skey_forbid') || ''
    diag.hasQmKeyst = Boolean(jar.get('qm_keyst') || jar.get('qqmusic_key'))

    let pSkey = jar.get('p_skey')
    let usedSkeyFallback = false
    if (!pSkey) {
      const uin = extractUin(jar)
      diag.uin = uin
      // 先探测旧版接口到底认不认这套会话
      const legacy = await probeLegacy(jar, uin, diag)
      if (legacy.profileCode === 0 || legacy.collectedCode === 0) {
        logStep('p_skey missing, but legacy endpoints accept this session', JSON.stringify(legacy))
        return { partial: true, uin, profile: null }
      }
      // 再兜底：尝试用 skey 计算 g_tk（可能失败）
      const skey = jar.get('skey') || jar.get('superkey')
      if (skey) {
        logStep('p_skey missing, fallback to skey for g_tk')
        pSkey = skey
        usedSkeyFallback = true
        diag.usedSkeyFallback = true
      }
    }
    if (!pSkey) {
      const forbid = Boolean(jar.get('p_skey_forbid'))
      diag.failure = forbid ? 'p_skey_forbid' : 'no_p_skey'
      logStep('check_sig FAILED', `forbid=${forbid} jar=${Array.from(jar.keys()).join(',')}`)
      const err = new Error(
        forbid ? '腾讯拒绝为该账号下发 p_skey（p_skey_forbid）' : '未获取到 p_skey，登录流程中断'
      )
      err.forbid = forbid
      err.fallback = true
      err.diag = diag
      throw err
    }

    await exchangeTicket(jar, pSkey, diag, usedSkeyFallback)
    return { partial: false }
  }

  /**
   * 票据兑换：g_tk 由 p_skey 计算 → POST authorize 拿 code → POST musicu 换 qm_keyst。
   * 扫码流程（completeCredential）与「网页登录」的补完都走这里。
   */
  async function exchangeTicket(jar, pSkey, diag = {}, usedSkeyFallback = false) {
    const gtk = getGtk(pSkey)
    diag.gtkSource = usedSkeyFallback ? 'skey' : 'p_skey'

    const form = new FormData()
    form.append('response_type', 'code')
    form.append('client_id', CLIENT_ID)
    form.append('redirect_uri', REDIRECT_URI)
    form.append('scope', 'get_user_info,get_app_friends')
    form.append('state', 'state')
    form.append('switch', '')
    form.append('from_ptlogin', '1')
    form.append('src', '1')
    form.append('update_auth', '1')
    form.append('openapi', '1010_1030')
    form.append('g_tk', String(gtk))
    form.append('auth_time', new Date().toString())
    form.append('ui', guid())

    const authRes = await reqJar(jar, 'https://graph.qq.com/oauth2.0/authorize', {
      method: 'POST',
      body: form,
    })
    const location = authRes.headers.get('location') || ''
    const authBody = await authRes.text().catch(() => '')
    diag.authorize = {
      status: authRes.status,
      location: location.slice(0, 400),
      body: String(authBody).replace(/\s+/g, ' ').slice(0, 300),
    }
    logStep('authorize resp', `status=${authRes.status} location=${location || '-'}`)
    const codeMatch = location.match(/[?&]code=([^&]+)/)
    if (authRes.status < 300 || authRes.status >= 400 || !codeMatch) {
      const forbid = Boolean(jar.get('p_skey_forbid'))
      diag.failure = usedSkeyFallback ? 'authorize_failed_after_skey_fallback' : 'authorize_failed'
      const reason = usedSkeyFallback ? '（该账号未下发 p_skey，已用 skey 代替，通常无效）' : ''
      const err = new Error(
        `授权失败，未取得 code（HTTP ${authRes.status}）${reason}` +
          (location ? `\n跳转：${location.slice(0, 180)}` : '')
      )
      err.fallback = true
      err.forbid = forbid
      err.location = location
      err.diag = diag
      throw err
    }
    const code = codeMatch[1]
    diag.hasCode = true

    const payload = JSON.stringify({
      comm: { g_tk: gtk, platform: 'yqq', ct: 24, cv: 0 },
      req: { module: 'QQConnectLogin.LoginServer', method: 'QQLogin', param: { code } },
    })
    const loginRes = await reqJar(jar, 'https://u.y.qq.com/cgi-bin/musicu.fcg', {
      method: 'POST',
      body: payload,
      contentType: 'application/x-www-form-urlencoded',
      referer: 'https://y.qq.com/',
    })
    const loginBody = await loginRes.text().catch(() => '')
    let loginJson = null
    try {
      loginJson = JSON.parse(loginBody)
    } catch {
      loginJson = null
    }
    const setCookieNames = setCookieList(loginRes.headers).map((c) => String(c).split('=')[0].trim())
    diag.musicu = {
      status: loginRes.status,
      code: loginJson?.req?.code ?? loginJson?.req_0?.code ?? loginJson?.code ?? null,
      msg: loginJson?.req?.msg || loginJson?.req_0?.msg || loginJson?.msg || '',
      setCookie: setCookieNames,
      body: String(loginBody).replace(/\s+/g, ' ').slice(0, 300),
    }
    diag.hasQmKeystAfter = Boolean(jar.get('qm_keyst') || jar.get('qqmusic_key'))
    logStep('musicu login resp', `status=${loginRes.status} body=${diag.musicu.body}`)
    return { code }
  }

  /**
   * 用一段已有 Cookie（登录后从 WebView 取回，须含 p_skey）自己完成票据兑换。
   * 「网页登录」用它绕开 QQ 的授权页（那里会要求拉起手机 QQ）。
   * @returns {Promise<{ cookie: string, hasMusicKey: boolean, diag: object }>}
   */
  async function exchangeWithCookie(cookieText) {
    const jar = new Map(parseCookieString(cookieText).entries())
    const diag = { mode: 'exchangeWithCookie', pSkey: { present: jar.has('p_skey') } }
    let pSkey = jar.get('p_skey')
    let usedSkeyFallback = false
    if (!pSkey) {
      const skey = jar.get('skey') || jar.get('superkey')
      if (skey) {
        pSkey = skey
        usedSkeyFallback = true
      }
    }
    if (!pSkey) throw new Error('Cookie 里没有 p_skey，无法兑换音乐票据（登录可能未完成）')
    await exchangeTicket(jar, pSkey, diag, usedSkeyFallback)
    const hasMusicKey = Boolean(jar.get('qm_keyst') || jar.get('qqmusic_key'))
    diag.hasMusicKey = hasMusicKey
    const cookie = cookieString(jar)
    return { cookie, hasMusicKey, diag }
  }

  /** 第一步：生成二维码 */
  async function startLogin() {
    const sid = randomId()
    const jar = new Map()
    const referer = xloginUrl()

    await reqJar(jar, referer, { referer: 'https://xui.ptlogin2.qq.com/' })

    const qrRes = await reqJar(jar, qrShowUrl(), { referer })
    const buffer = await qrRes.arrayBuffer()
    const bytes = new Uint8Array(buffer)

    const qrsig = jar.get('qrsig')
    if (!qrsig) throw new Error('未能获取 qrsig，二维码生成失败（可能被风控）')
    if (bytes.length < 100 || bytes[0] !== 0x89) throw new Error('二维码返回内容异常')

    sessions.set(sid, { jar, loginJar: new Map(), qrsig, referer, created: Date.now() })
    return { sid, image: `data:image/png;base64,${bytesToBase64(bytes)}` }
  }

  /** 第二步：轮询扫码状态 */
  async function pollLogin(sid) {
    const session = sessions.get(sid)
    if (!session) return { status: 'expired', message: '登录会话不存在或已过期，请刷新二维码' }
    if (Date.now() - session.created > SESSION_TTL) {
      sessions.delete(sid)
      return { status: 'expired', message: '二维码已过期，请刷新' }
    }

    // 与参考实现对齐：轮询只带 qrsig；轮询响应下发的登录 Cookie 单独收集到 loginJar，
    // 之后的 check_sig / authorize / musicu 只用 loginJar，避免把 qrsig、pt_login_sig 等
    // 二维码会话 Cookie 带进登录兑换流程（否则可能被下发 p_skey_forbid）。
    const res = await reqJar(session.jar, qrLoginUrl(session), {
      referer: session.referer,
      cookieOverride: `qrsig=${session.qrsig}`,
      extraJar: session.loginJar,
    })
    const text = await res.text()
    if (!text.includes('ptuiCB')) {
      return { status: 'error', message: `登录接口返回异常 (HTTP ${res.status})` }
    }
    const { code, redirectUrl, message, nickname } = parsePtuiCB(text)

    // 诊断信息：完整的轮询原始响应 + 各步骤结果，失败时返回给前端展示
    const diag = {
      ptuiCB: text.slice(0, 300),
      pollCode: code,
      pollMessage: message,
      nickname,
      loginJarAfterPoll: cookieSummary(session.loginJar),
    }

    if (code === '0' && redirectUrl) {
      if (!isAllowedLoginUrl(redirectUrl)) {
        sessions.delete(sid)
        return { status: 'error', message: '登录跳转地址不受信任，已中止登录', fallback: true, diag }
      }
      // 先删会话：兑换 code 是多次网络往返，期间若有并发轮询，不能让它们也去兑换
      sessions.delete(sid)
      diag.redirectUrl = redirectUrl.slice(0, 400)
      logStep('qr confirmed', `redirectUrl=${redirectUrl}`)
      logStep('loginJar after poll', Array.from(session.loginJar.keys()).join(','))
      let result = { partial: false }
      try {
        result = await completeCredential(session.loginJar, redirectUrl, diag)
      } catch (e) {
        const who = nickname ? `\n扫码账号：${nickname}` : ''
        return {
          status: 'error',
          message: (e.message || '换取音乐登录票据失败') + who,
          fallback: Boolean(e.fallback),
          forbid: Boolean(e.forbid),
          diag: e.diag || diag,
        }
      }
      const uin = result.uin || extractUin(session.loginJar)
      const cookie = cookieString(session.loginJar)
      let profile = result.profile || null
      if (!profile) {
        try {
          profile = await fetchProfile(session.loginJar, uin)
        } catch {
          profile = null
        }
      }
      diag.cookiesFinal = cookieSummary(session.loginJar)
      diag.failure = diag.failure || null
      return {
        status: 'success',
        uin,
        nickname: profile?.nickname || nickname || '',
        avatar: profile?.avatar || '',
        vip: profile?.vip || 0,
        hasMusicKey: Boolean(session.loginJar.get('qm_keyst') || session.loginJar.get('qqmusic_key')),
        partial: Boolean(result.partial),
        cookie,
        diag,
      }
    }

    if (/已扫码|认证中|待确认|扫描成功/.test(message) || code === '67') {
      return { status: 'scanned', message: message || '已扫码，请在手机上确认' }
    }
    if (/未失效|待扫描|尚未|二维码未/.test(message) || code === '66') {
      return { status: 'waiting', message: message || '请使用手机 QQ 扫码' }
    }
    if (/失效|过期|取消/.test(message) || ['65', '10009', '10006'].includes(code)) {
      sessions.delete(sid)
      return { status: 'expired', message: message || '二维码已失效，请刷新' }
    }
    return { status: 'error', message: message || `登录失败(${code})` }
  }

  function closeSession(sid) {
    if (sid) sessions.delete(sid)
  }

  /** 清理过期会话，避免反复刷新二维码导致内存无限增长 */
  function sweep() {
    const now = Date.now()
    for (const [sid, s] of sessions) {
      if (now - s.created > SESSION_TTL) sessions.delete(sid)
    }
  }

  return { startLogin, pollLogin, closeSession, sweep, sessions, exchangeWithCookie }
}

/** 字节数组 → base64（浏览器没有 Buffer） */
export function bytesToBase64(bytes) {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64')
  let bin = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK))
  }
  return btoa(bin)
}
