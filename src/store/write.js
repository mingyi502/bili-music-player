/**
 * 写操作前端守卫（P4.0）：票据检查 + 统一错误提示。
 * 所有会改账号数据的 UI 动作先 `ensureWritable()`，再调用 api 层的写接口。
 */
import { state } from './state.js'
import { toast } from './ui.js'
import { canWrite } from '../api/qq/write.js'

/** 有票据才允许写；否则提示并打开登录弹窗 */
export function ensureWritable() {
  if (canWrite(state.config.qqCookie)) return true
  toast('当前登录缺少音乐票据（qm_keyst），无法执行写操作：请重新登录，或使用「网页登录 / 手动 Cookie」', 'error')
  state.loginOpen = true
  return false
}

/** 统一展示写操作错误；登录/票据类错误顺带打开登录弹窗 */
export function toastWriteError(e) {
  const msg = e?.message || '操作失败'
  toast(msg, 'error')
  if (/qm_keyst|音乐票据|未登录|登录已失效|登录态无效/.test(msg)) state.loginOpen = true
}
