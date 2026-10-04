/**
 * 下载/本地音乐能力桥（P6）。
 *
 * 与 mediaControl / mediaCache 同一模式：原生平台注入 backend，Web 无此能力
 * （下载、导入、存储管理入口在 Web 隐藏）。
 */
let backend = null

export function setDownloadBackend(b) {
  backend = b || null
}

export function hasDownloads() {
  return !!backend
}

export function downloadBackend() {
  return backend
}
