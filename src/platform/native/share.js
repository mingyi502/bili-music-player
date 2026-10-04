/**
 * 移动端系统分享（Capacitor Share）。
 * Web 端不注入（见 core/share.js），只保留复制链接 + 二维码。
 */
import { Share } from '@capacitor/share'

export function createNativeShare() {
  return {
    async share({ title, text, url } = {}) {
      await Share.share({
        title: title || '',
        text: text || '',
        url: url || '',
        dialogTitle: '分享',
      })
    },
  }
}
