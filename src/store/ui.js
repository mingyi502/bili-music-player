/** 界面状态动作：侧栏 / 全屏播放器 / 全局提示。 */
import { state, LS } from './state.js'

export function toast(message, type = 'info') {
  const id = Date.now() + Math.random()
  state.toasts.push({ id, message, type })
  setTimeout(() => {
    const i = state.toasts.findIndex((t) => t.id === id)
    if (i > -1) state.toasts.splice(i, 1)
  }, 3200)
}

// ── 移动端界面动作（桌面端不受影响） ──────────────────────────────────────
export function openSidebar() {
  state.ui.sidebarOpen = true
}
export function closeSidebar() {
  state.ui.sidebarOpen = false
}
export function toggleSidebar() {
  state.ui.sidebarOpen = !state.ui.sidebarOpen
}
export function expandPlayer() {
  // 当前曲可能来自主列表（player.index）或本地/恢复的队列（queueIndex），两者任一有效即可展开
  if (state.player.index >= 0 || state.player.queueIndex >= 0) state.ui.playerExpanded = true
}
export function collapsePlayer() {
  state.ui.playerExpanded = false
}

// ── 播放队列面板 ──────────────────────────────────────────────────────────
export function openQueue() {
  state.ui.queueOpen = true
}
export function closeQueue() {
  state.ui.queueOpen = false
}
export function toggleQueue() {
  state.ui.queueOpen = !state.ui.queueOpen
}

// ── 全屏播放器歌词视图（记住上次选择） ──────────────────────────────────
export function setShowLyrics(v) {
  state.ui.showLyrics = !!v
  try {
    localStorage.setItem(LS.lyricView, JSON.stringify(state.ui.showLyrics))
  } catch {
    /* 配额异常不打断业务 */
  }
}
export function toggleLyrics() {
  setShowLyrics(!state.ui.showLyrics)
}

// ── 分享面板（P5 E3）：复制链接 + 二维码 +（App）系统分享 ────────────────
export function openShare({ title = '', subtitle = '', url = '' } = {}) {
  const link = String(url || '').trim()
  if (!link) {
    toast('这个内容没有可分享的链接', 'info')
    return false
  }
  state.ui.share = { open: true, title: String(title || ''), subtitle: String(subtitle || ''), url: link }
  return true
}
export function closeShare() {
  state.ui.share.open = false
}

// ── 通用底部动作面板（移动端行内「更多」等入口） ──────────────────────────
// 用法：openActionSheet({ title, items: [{ icon, label, danger, onClick }] })
export function openActionSheet({ title = '', items = [] } = {}) {
  state.actionSheet = { open: true, title, items: Array.isArray(items) ? items : [] }
}
export function closeActionSheet() {
  state.actionSheet = { open: false, title: '', items: [] }
}

// ── 通用二次确认弹窗（P4.0） ──────────────────────────────────────────────
// 用法：if (!(await askConfirm({ title, message, danger: true }))) return
let confirmResolve = null

export function askConfirm({ title = '确认操作', message = '', confirmText = '确认', cancelText = '取消', danger = false } = {}) {
  return new Promise((resolve) => {
    confirmResolve = resolve
    Object.assign(state.confirm, { open: true, title, message, confirmText, cancelText, danger, input: null })
  })
}

/**
 * 带输入框的确认弹窗（如「新建歌单」）。
 * @returns {Promise<string|null>} 确认返回输入值（可能为空串，由调用方校验），取消返回 null
 */
export function askPrompt({ title = '请输入', message = '', placeholder = '', confirmText = '确定', cancelText = '取消', value = '' } = {}) {
  return new Promise((resolve) => {
    confirmResolve = resolve
    Object.assign(state.confirm, {
      open: true,
      title,
      message,
      confirmText,
      cancelText,
      danger: false,
      input: { value, placeholder },
    })
  })
}

/** 弹窗按钮回调：ok=true 确认（带输入时返回输入值），false 取消（返回 null） */
export function resolveConfirm(ok) {
  state.confirm.open = false
  const resolve = confirmResolve
  confirmResolve = null
  if (!resolve) return
  if (!ok) return resolve(null)
  resolve(state.confirm.input ? String(state.confirm.input.value || '') : true)
}
