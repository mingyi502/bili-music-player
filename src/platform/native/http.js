/**
 * 移动端 HTTP 适配层（Capacitor 原生 HTTP）。
 *
 * 为什么必须用原生：Capacitor 的页面跑在 https://localhost 下，
 * 直接 fetch 上游会被 CORS 拦；原生 HTTP 不受同源策略约束，
 * 且能设置浏览器禁止的 Referer / Cookie / User-Agent。
 *
 * 本文件通过依赖注入接收 CapacitorHttp，因此纯逻辑可用假件单测。
 */
import { resolveUpstream, USER_AGENT } from '../../core/upstreams.js'
import { splitSetCookie } from '../../core/qqLogin.js'
import { looksLikeBase64, base64ToBytes, base64ToBlob, headerOf } from './base64.js'

/** 把 CapacitorHttp 的返回包装成 fetch 的 Response 形状 */
function decodeBody(data) {
  if (data === null || data === undefined) return ''
  if (typeof data === 'string') return data
  if (data instanceof ArrayBuffer) return new TextDecoder('utf-8').decode(data)
  if (ArrayBuffer.isView(data)) return new TextDecoder('utf-8').decode(data)
  if (typeof data === 'object') return JSON.stringify(data)
  return String(data)
}

function toArrayBuffer(data) {
  if (data instanceof ArrayBuffer) return data
  if (ArrayBuffer.isView(data)) return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
  return new TextEncoder().encode(decodeBody(data)).buffer
}

function wrapHeaders(headers) {
  const map = new Map()
  for (const [k, v] of Object.entries(headers || {})) {
    map.set(String(k).toLowerCase(), Array.isArray(v) ? v.join(', ') : String(v))
  }
  return {
    get: (name) => (map.has(String(name).toLowerCase()) ? map.get(String(name).toLowerCase()) : null),
    getSetCookie: () => {
      const raw = map.get('set-cookie')
      return raw ? splitSetCookie(raw) : []
    },
    raw: () => Object.fromEntries(map),
  }
}

/**
 * 把 CapacitorHttp 的响应包装成 fetch 的 Response。
 *
 * @param {object} res
 * @param {boolean} binary 本次请求是否用了 responseType=arraybuffer/blob。
 *   此时**成功响应**的 data 是 base64 字符串（见 base64.js 说明）；
 *   **非 2xx 响应**走 error stream，返回的是纯文本，不做 base64 解码。
 */
function wrapResponse(res, { binary = false } = {}) {
  const status = Number(res?.status || 0)
  const ok = status >= 200 && status < 300
  const raw = res?.data
  const isBase64 = binary && ok && typeof raw === 'string' && looksLikeBase64(raw)
  const bytes = isBase64 ? base64ToBytes(raw) : null
  const body = bytes ? new TextDecoder('utf-8').decode(bytes) : decodeBody(raw)
  const mime = headerOf(res?.headers, 'content-type') || 'application/octet-stream'

  return {
    status,
    ok,
    url: res?.url || '',
    headers: wrapHeaders(res?.headers),
    text: async () => body,
    json: async () => JSON.parse(body),
    arrayBuffer: async () => (bytes ? bytes.buffer : toArrayBuffer(raw)),
    blob: async () => (bytes ? base64ToBlob(raw, mime) : new Blob([toArrayBuffer(raw)], { type: mime })),
  }
}

/** CapacitorHttp 的超时/网络错误 → 与 fetch 一致的 AbortError（便于上层统一提示） */
function asAbort(e, label) {
  const msg = String(e?.message || e || '')
  if (/timeout|timed out|abort/i.test(msg)) {
    const err = new Error(`${label}请求超时`)
    err.name = 'AbortError'
    return err
  }
  return e
}

/**
 * @param {object} deps
 * @param {object} deps.CapacitorHttp `@capacitor/core` 的 CapacitorHttp
 * @param {string} [deps.referer]     图片/音频下载使用的 Referer
 */
export function createNativeHttp({ CapacitorHttp, referer = 'https://www.bilibili.com/' } = {}) {
  if (!CapacitorHttp) throw new Error('createNativeHttp 需要 CapacitorHttp')

  /**
   * 相对代理路径 + 自定义 Cookie 头 → 真实域名 + Referer/Cookie。
   * 例：/qq-api/rsc/x?a=1  Headers{X-QQ-Cookie}  →  https://c.y.qq.com/rsc/x?a=1  Cookie: ...
   */
  function interceptor(url, { headers } = {}) {
    const up = resolveUpstream(url)
    if (!up) return null
    const rest = url.slice(up.prefix.length)
    const next = { ...(headers || {}) }
    const cookie = up.cookieHeader ? next[up.cookieHeader] : undefined
    if (up.cookieHeader) delete next[up.cookieHeader]
    next.Referer = up.referer
    if (up.origin) next.Origin = up.origin
    if (cookie) next.Cookie = cookie
    return { url: up.target + rest, headers: next }
  }

  /** fetch 兼容的发送实现，供 core/http.js 的 httpRequest 使用 */
  async function requestTransport(url, { method = 'GET', headers, body, timeout = 15000 } = {}) {
    const out = { ...(headers || {}) }
    if (!out['User-Agent'] && !out['user-agent']) out['User-Agent'] = USER_AGENT
    try {
      const res = await CapacitorHttp.request({
        url,
        method,
        headers: out,
        data: normalizeBody(body, out),
        connectTimeout: timeout,
        readTimeout: timeout,
      })
      return wrapResponse(res)
    } catch (e) {
      throw asAbort(e, '')
    }
  }

  /**
   * 供 src/core/qqLogin.js 使用的 transport。
   * - disableRedirects：登录流程需要自己跟随 302 并逐跳收集 Set-Cookie
   * - responseType: arraybuffer：二维码是 PNG 二进制（CapacitorHttp 会返回 base64，
   *   由 wrapResponse 解码），其余响应同样能还原成文本
   */
  async function transport({ url, method = 'GET', headers, body, timeout = 15000 }) {
    const out = { ...(headers || {}) }
    if (!out['User-Agent'] && !out['user-agent']) out['User-Agent'] = USER_AGENT
    try {
      const res = await CapacitorHttp.request({
        url,
        method,
        headers: out,
        data: normalizeBody(body, out),
        responseType: 'arraybuffer',
        disableRedirects: true,
        connectTimeout: timeout,
        readTimeout: timeout,
      })
      return wrapResponse(res, { binary: true })
    } catch (e) {
      throw asAbort(e, '登录接口')
    }
  }

  /** 直接取二进制（图片用），返回真正的 Blob */
  async function fetchBlob(url, extraHeaders = {}) {
    const res = await CapacitorHttp.request({
      url,
      headers: { 'User-Agent': USER_AGENT, Referer: referer, ...extraHeaders },
      responseType: 'blob',
    })
    if (res.status < 200 || res.status >= 300) throw new Error(`资源请求失败 (${res.status})`)
    return base64ToBlob(String(res.data ?? ''), headerOf(res.headers, 'content-type') || 'application/octet-stream')
  }

  return { interceptor, requestTransport, transport, fetchBlob }
}

/**
 * 原生层只接受字符串 / JSON。
 * FormData（QQ 授权请求）统一转成 x-www-form-urlencoded —— 标准 OAuth 端点均接受。
 */
function normalizeBody(body, headers) {
  if (body === undefined || body === null) return undefined
  if (typeof body === 'string') return body
  if (typeof FormData !== 'undefined' && body instanceof FormData) {
    const sp = new URLSearchParams()
    for (const [k, v] of body.entries()) sp.append(k, typeof v === 'string' ? v : '')
    const text = sp.toString()
    if (!headers['Content-Type'] && !headers['content-type']) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded'
    }
    return text
  }
  return body
}
