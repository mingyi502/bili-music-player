/**
 * 登录/访问控制接口。
 *
 * Web：请求本地 Node 中间件的 /auth-api/*（服务端维护扫码会话与 Cookie）。
 * 移动端：不存在本地服务，由 src/platform/native/auth.js 在客户端直接完成扫码登录。
 *        平台层通过 setAuthBackend() 注入实现，业务代码无需感知。
 */

let backend = null
let webLogin = null

/** 平台侧注入实现（移动端） */
export function setAuthBackend(impl) {
  backend = impl
}

/** 平台侧注入「网页登录」（仅 Android 支持） */
export function setWebLogin(impl) {
  webLogin = impl
}

/** 当前平台是否支持「打开 QQ 登录页」这种登录方式 */
export function supportsWebLogin() {
  return Boolean(webLogin)
}

/**
 * 打开腾讯官方登录页完成登录，返回 { cookie, url, hasMusicKey }。
 * 浏览器受同源策略限制，无法读取第三方域名的 Cookie，因此仅原生端可用。
 * @param {object} [opts] 透传给平台实现（如 { allowOneKey } 一键登录实验开关）
 */
export async function webLoginPage(opts = {}) {
  if (!webLogin) throw new Error('当前环境不支持网页登录，请使用扫码或手动 Cookie')
  return webLogin.open(opts)
}

/** 清空网页登录遗留的浏览器 Cookie（退出登录时调用） */
export async function clearWebLoginCookies() {
  if (webLogin) await webLogin.clear()
}

/**
 * @param {string} url
 * @param {object} options fetch 选项
 * @param {number} [timeout] 客户端超时（毫秒，0=不限）；避免请求悬挂把轮询卡死
 */
async function jsonFetch(url, options, timeout = 0) {
  const controller = timeout > 0 ? new AbortController() : null
  const timer = controller ? setTimeout(() => controller.abort(), timeout) : null
  try {
    const res = await fetch(url, controller ? { ...options, signal: controller.signal } : options)
    const data = await res.json().catch(() => ({}))
    if (!res.ok || data.ok === false) {
      throw new Error(data.message || `请求失败 (${res.status})`)
    }
    return data
  } catch (e) {
    if (e?.name === 'AbortError') throw new Error('请求超时')
    throw e
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** 探测本地服务/代理层是否可达 */
export async function pingServer(timeout = 5000) {
  if (backend) return backend.pingServer(timeout)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  try {
    const res = await fetch('/auth-api/ping', { cache: 'no-store', signal: controller.signal })
    if (!res.ok) return false
    const data = await res.json().catch(() => ({}))
    return data.ok === true
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 读取服务状态与访问控制状态。
 * 返回 { reachable, authRequired, authed }：局域网模式开启时 authRequired=true。
 */
export async function fetchPing(timeout = 5000) {
  if (backend) return backend.fetchPing(timeout)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  try {
    const res = await fetch('/auth-api/ping', { cache: 'no-store', signal: controller.signal })
    if (!res.ok) return { reachable: false, authRequired: false, authed: false }
    const data = await res.json().catch(() => ({}))
    return {
      reachable: data.ok === true,
      authRequired: Boolean(data.authRequired),
      authed: data.authRequired ? Boolean(data.authed) : true,
    }
  } catch {
    return { reachable: false, authRequired: false, authed: false }
  } finally {
    clearTimeout(timer)
  }
}

/** 提交访问口令，成功后会由服务端下发 HttpOnly Cookie */
export async function unlock(rawCode) {
  if (backend) return backend.unlock(rawCode)
  const res = await fetch('/auth-api/unlock', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: String(rawCode || '') }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || data.ok === false) throw new Error(data.message || '口令校验失败')
  return data
}

/** 生成登录二维码，返回 dataURL（服务端要访问腾讯登录页，超时放宽） */
export async function startQrLogin() {
  if (backend) return backend.startQrLogin()
  const data = await jsonFetch('/auth-api/qr/start', { method: 'POST' }, 45000)
  if (!data.image) throw new Error('二维码获取失败')
  return data.image
}

/**
 * 轮询扫码状态：waiting | scanned | expired | success | error
 * 超时取 60s：必须大于服务端换票的最坏时长，否则中途 abort 会造成「已换票但会话被删」的假失效。
 */
export async function pollQrLogin() {
  if (backend) return backend.pollQrLogin()
  return jsonFetch('/auth-api/qr/poll', {}, 60000)
}

export async function closeQrSession() {
  if (backend) return backend.closeQrSession()
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timer = controller ? setTimeout(() => controller.abort(), 5000) : null
  try {
    await fetch('/auth-api/session/close', { method: 'POST', ...(controller ? { signal: controller.signal } : {}) })
  } catch {
    /* 忽略：会话清理失败不影响使用 */
  } finally {
    if (timer) clearTimeout(timer)
  }
}
