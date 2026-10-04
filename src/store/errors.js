/** 运行时错误记录（诊断面板数据源）。 */
import { state } from './state.js'
import { toast } from './ui.js'

/** 记录运行时错误，供诊断面板展示 */
export function recordError(scope, message) {
  pushError(scope, message)
  toast(`${scope}：${String(message || '')}`, 'error')
}

/** 只记录、不弹提示 */
export function pushError(scope, message) {
  const entry = { time: new Date().toLocaleTimeString(), scope, message: String(message || '') }
  state.diagnostics.errors.unshift(entry)
  if (state.diagnostics.errors.length > 30) state.diagnostics.errors.pop()
}
