/**
 * 统一的请求适配层（平台无关）。
 *
 * Web 端：请求落到「相对路径」，由 Vite 开发服务器代理转发到上游并补上
 *         Referer / Origin / Cookie（浏览器禁止前端设置这些头）。
 *
 * 移动端（Capacitor，阶段 4）：不存在开发服务器，也没有代理中间件。
 *         此时通过 setHttpInterceptor() 注入一个改写器，把相对路径换成
 *         src/core/upstreams.js 里的真实域名，并直接带上 Referer / Cookie，
 *         由原生 HTTP 插件发出请求。
 *
 * 这样 src/api/* 里的业务代码只描述「请求哪个上游的哪个路径」，无需关心平台。
 */

let interceptor = null
let requestTransport = null

/** 平台侧注入请求改写器：interceptor(url, options) → 可返回 { url, headers } */
export function setHttpInterceptor(fn) {
  interceptor = fn
}

/**
 * 平台侧注入底层发送实现（fetch 兼容）。
 * 移动端用 CapacitorHttp 发送：浏览器 fetch 受 CORS 限制，无法直连上游。
 */
export function setRequestTransport(fn) {
  requestTransport = fn
}

/** 当前是否已注入平台实现（便于调试/测试） */
export function hasHttpInterceptor() {
  return typeof interceptor === 'function'
}

/**
 * 发出一次请求，返回原始 Response。
 * - 不抛 HTTP 状态错误（是否按状态报错由调用方决定，保持各接口原有提示语）
 * - 超时统一用 AbortController 实现，超时抛出「<label>请求超时」
 */
export async function httpRequest(url, { method = 'GET', headers, body, timeout = 15000, label = '接口' } = {}) {
  let finalUrl = url
  let finalHeaders = headers ? { ...headers } : undefined

  if (interceptor) {
    const rewritten = await interceptor(url, { method, headers: finalHeaders, body, timeout, label })
    if (rewritten) {
      if (rewritten.url) finalUrl = rewritten.url
      if (rewritten.headers) finalHeaders = { ...finalHeaders, ...rewritten.headers }
    }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  try {
    const send = requestTransport || ((u, init) => fetch(u, init))
    return await send(finalUrl, { method, headers: finalHeaders, body, signal: controller.signal })
  } catch (e) {
    if (e?.name === 'AbortError') throw new Error(`${label}请求超时`)
    throw e
  } finally {
    clearTimeout(timer)
  }
}

export function qs(params) {
  const sp = new URLSearchParams()
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null) sp.set(k, String(v))
  })
  return sp.toString()
}

/**
 * 图片地址 → 可显示地址。
 * Web：交给 /img-api 代理（服务端补 Referer 绕过防盗链）。
 * 移动端：通过 setMediaResolvers() 注入原生实现（下载后转对象 URL）。
 */
let imageResolver = null
let audioResolver = null

export function setMediaResolvers({ image, audio } = {}) {
  if (image) imageResolver = image
  if (audio) audioResolver = audio
}

export function resolveImageUrl(url) {
  if (!url) return ''
  if (imageResolver) return imageResolver(url)
  return '/img-api?url=' + encodeURIComponent(url)
}

/**
 * 音频地址 → 可播放地址。
 * Web：/media-api 流式代理（透传 Range，可拖动）。
 * 移动端：注入的实现会先下载到本地再返回（可能是 Promise），调用方需 await。
 */
export function resolveAudioUrl(url) {
  if (!url) return ''
  if (audioResolver) return audioResolver(url)
  return '/media-api?url=' + encodeURIComponent(url)
}
