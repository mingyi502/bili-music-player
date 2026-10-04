/**
 * 原生剪贴板实现（@capacitor/clipboard）。
 * 用原生插件而不是 navigator.clipboard：后者在 WebView 里要求可信用户手势，
 * 无法在「应用回到前台」时自动读取。
 */
import { Clipboard } from '@capacitor/clipboard'

export function createNativeClipboard() {
  return {
    read: async () => {
      const { value } = await Clipboard.read()
      return String(value || '')
    },
    write: async (text) => {
      await Clipboard.write({ string: String(text ?? '') })
    },
  }
}
