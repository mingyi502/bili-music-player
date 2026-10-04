/**
 * 移动端登录后端。
 *
 * Web 端扫码登录依赖本地 Node 中间件维护服务端会话；移动端没有服务，
 * 因此直接复用平台无关的 src/core/qqLogin.js，配原生 HTTP transport 在客户端完成
 * 生成二维码 → 轮询 → 换取音乐票据的全过程。
 *
 * 访问口令（局域网模式）在移动端没有意义，一律视为「已解锁」。
 */
import { createQqLogin } from '../../core/qqLogin.js'

/**
 * @param {object} deps
 * @param {Function} deps.transport 原生 HTTP transport（见 platform/native/http.js）
 * @param {Function} [deps.log]     调试日志
 */
export function createNativeAuth({ transport, log } = {}) {
  if (typeof transport !== 'function') throw new Error('createNativeAuth 需要 transport')

  const login = createQqLogin({ transport, log })
  let currentSid = ''

  async function startQrLogin() {
    const { sid, image } = await login.startLogin()
    currentSid = sid
    return image
  }

  async function pollQrLogin() {
    if (!currentSid) return { status: 'expired', message: '会话不存在，请刷新二维码' }
    const result = await login.pollLogin(currentSid)
    // 成功/过期后会话已失效，避免重复兑换 code
    if (result.status === 'success' || result.status === 'expired' || result.status === 'error') {
      currentSid = ''
    }
    return result
  }

  async function closeQrSession() {
    login.closeSession(currentSid)
    currentSid = ''
  }

  /**
   * 网页登录的票据补完：用 WebView 登录后拿到的 Cookie（含 p_skey）自己完成兑换。
   * 这样就不必依赖 QQ 授权页（那里的一键登录需要拉起手机 QQ App）。
   */
  async function exchangeWebLogin(cookie) {
    return login.exchangeWithCookie(cookie)
  }

  return {
    startQrLogin,
    pollQrLogin,
    closeQrSession,
    exchangeWebLogin,
    pingServer: async () => true,
    // 移动端是本地应用，没有服务端访问控制
    fetchPing: async () => ({ reachable: true, authRequired: false, authed: true }),
    unlock: async () => {
      throw new Error('移动端无需访问口令')
    },
    /** 清理内存中的登录会话 */
    dispose() {
      if (currentSid) login.closeSession(currentSid)
      currentSid = ''
    },
  }
}
