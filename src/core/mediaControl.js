/**
 * 媒体控制 / 桌面歌词后端注入点（平台无关）。
 *
 * - Web：不注入（浏览器走 `src/store/mediaSession.js` 的 Media Session API）
 * - App：`src/platform/native/mediaControl.js` 注入 Capacitor 插件实现
 *
 * 注入后：
 * - `mediaControlUpdate(payload)` 推送播放状态 → 原生 MediaSession + 通知栏
 * - `mediaControlOnAction(cb)`  接收通知栏 / 锁屏 / 蓝牙按键动作
 * - `mediaControlSetOverlay` / `mediaControlUpdateLyric` 控制桌面歌词悬浮窗
 */
let backend = null

export function setMediaControlBackend(b) {
  backend = b
}

export function hasMediaControl() {
  return Boolean(backend)
}

export function mediaControlUpdate(payload) {
  if (!backend) return
  Promise.resolve(backend.update(payload)).catch(() => {
    /* 原生推送失败不影响播放 */
  })
}

export function mediaControlClear() {
  if (!backend) return
  Promise.resolve(backend.clear()).catch(() => {})
}

export function mediaControlSetOverlay(enabled) {
  return backend ? Promise.resolve(backend.setOverlay(!!enabled)).catch(() => {}) : Promise.resolve()
}

/**
 * 更新悬浮窗歌词。
 * @param {object} payload { line, trans, roma, words, sung, progress }
 *   - words 为逐字单元数组（QRC）；sung 为当前词下标（-1 表示无）；progress 为当前词进度 0~1
 */
export function mediaControlUpdateLyric(payload) {
  if (!backend) return
  Promise.resolve(backend.updateLyric(payload || {})).catch(() => {})
}

export async function mediaControlHasOverlayPermission() {
  if (!backend) return false
  try {
    return Boolean(await backend.hasOverlayPermission())
  } catch {
    return false
  }
}

export function mediaControlRequestOverlayPermission() {
  return backend ? Promise.resolve(backend.requestOverlayPermission()).catch(() => {}) : Promise.resolve()
}

// ── 迷你播放器（H2，仅 App） ──────────────────────────────────────────────

export function hasMiniPlayer() {
  return Boolean(backend && typeof backend.setMiniPlayer === 'function')
}

export function mediaControlSetMiniPlayer(enabled) {
  if (!hasMiniPlayer()) return Promise.resolve()
  return Promise.resolve(backend.setMiniPlayer(!!enabled)).catch(() => {})
}

export function mediaControlUpdateMiniPlayer(payload) {
  if (!hasMiniPlayer()) return
  Promise.resolve(backend.updateMiniPlayer(payload || {})).catch(() => {})
}

export function mediaControlOnAction(cb) {
  if (backend) backend.onAction(cb)
}
