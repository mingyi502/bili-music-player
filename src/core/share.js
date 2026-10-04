/**
 * 系统分享后端注入点（平台无关）。
 * - Web：不注入（不显示「系统分享」，只提供复制链接与二维码）
 * - App：`src/platform/native/share.js` 注入 Capacitor Share 实现
 */
let backend = null

export function setShareBackend(impl) {
  backend = impl
}

export function canSystemShare() {
  return Boolean(backend)
}

export async function systemShare(payload) {
  if (!backend) throw new Error('当前环境不支持系统分享，请复制链接分享')
  return backend.share(payload || {})
}
