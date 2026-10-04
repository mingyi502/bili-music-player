/** 本地服务连通性与访问口令（局域网模式）。 */
import { state } from './state.js'
import { fetchPing, unlock as unlockRequest } from '../api/auth.js'

/** 启动时检查服务状态与访问口令状态 */
export async function initAuth() {
  const st = await fetchPing()
  state.auth = {
    reachable: st.reachable,
    required: Boolean(st.authRequired),
    authed: Boolean(st.authed),
    checked: true,
  }
  return state.auth
}

/** 提交访问口令（局域网模式） */
export async function unlockAccess(code) {
  await unlockRequest(code)
  const st = await initAuth()
  if (!st.authed) throw new Error('口令已提交但未生效，请重试')
  return st
}
