/**
 * base64 工具（CapacitorHttp 的二进制返回处理）。
 *
 * CapacitorHttp 在 responseType 为 `arraybuffer` / `blob` 时，**返回的是 base64 字符串**
 * 而不是二进制，两端实现都一样：
 *   - Web:     @capacitor/core/dist/index.js  → readBlobAsBase64(blob)
 *   - Android: HttpRequestHandler.java:256-258 → readStreamAsBase64(stream)
 *
 * 另外 Android 用 `Base64.DEFAULT` 编码，**每 76 字符会插入换行**；
 * 而非 2xx 响应走的是 error stream 分支，返回的是**纯文本**（不受 responseType 影响）。
 * 因此这里统一做「去掉空白 → 形态判定 → 解码」。
 */

const B64_RE = /^[A-Za-z0-9+/_-]*={0,2}$/

/** 去掉换行/空白，并把 URL-safe 字符转成标准 base64 */
export function normalizeBase64(str) {
  return String(str || '')
    .replace(/\s+/g, '')
    .replace(/-/g, '+')
    .replace(/_/g, '/')
}

/**
 * 是否是 base64 形态。
 * minLength 用来避免把 "error" 这类短文本误判成 base64。
 */
export function looksLikeBase64(str, minLength = 32) {
  if (typeof str !== 'string') return false
  const s = normalizeBase64(str)
  if (s.length < minLength) return false
  if (s.length % 4 !== 0) return false
  return B64_RE.test(s)
}

/** base64 → Uint8Array */
export function base64ToBytes(str) {
  const bin = atob(normalizeBase64(str))
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

/** base64 → Blob（图片等二进制资源用） */
export function base64ToBlob(str, mime = 'application/octet-stream') {
  return new Blob([base64ToBytes(str)], { type: mime })
}

/** 从响应头对象里按大小写不敏感取一个头 */
export function headerOf(headers, name) {
  if (!headers) return ''
  const want = String(name).toLowerCase()
  for (const [k, v] of Object.entries(headers)) {
    if (String(k).toLowerCase() === want) return Array.isArray(v) ? v.join(', ') : String(v)
  }
  return ''
}
