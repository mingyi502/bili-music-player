/**
 * 剪贴板读写（接口层）。
 *
 * Web 端退回标准 navigator.clipboard；移动端由 src/platform 注入原生实现
 * （@capacitor/clipboard）——因为 Android WebView 里 navigator.clipboard 要求
 * 可信用户手势，自动读取会被拒，而原生插件没有这个限制。
 */

let impl = null

/** 平台侧注入实现：{ read: () => Promise<string>, write: (text) => Promise<void> } */
export function setClipboard(next) {
  impl = next
}

/** 读取剪贴板文本；失败抛错（调用方自行决定是否提示） */
export async function readClipboard() {
  if (impl?.read) return String((await impl.read()) || '')
  if (!navigator.clipboard?.readText) throw new Error('当前环境不支持读取剪贴板')
  return String((await navigator.clipboard.readText()) || '')
}

/** 写入剪贴板文本 */
export async function writeClipboard(text) {
  const value = String(text ?? '')
  if (impl?.write) {
    await impl.write(value)
    return
  }
  if (!navigator.clipboard?.writeText) throw new Error('当前环境不支持写入剪贴板')
  await navigator.clipboard.writeText(value)
}
