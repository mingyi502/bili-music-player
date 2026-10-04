/**
 * 平台入口。
 *
 * Web 端：什么都不做（沿用本地 Node 代理 / 中间件）。
 * 移动端：安装原生 HTTP、媒体下载、客户端扫码登录，使同一套业务代码脱离本地服务运行。
 *
 * 原生实现按需动态加载，Web 打包不会把插件代码带进主包。
 */
import { Capacitor } from '@capacitor/core'

/** 是否运行在 Capacitor 原生容器内 */
export function isNative() {
  try {
    return Boolean(Capacitor?.isNativePlatform?.())
  } catch {
    return false
  }
}

let installed = null

/** 安装平台适配（幂等）。返回安装结果，Web 下返回 { platform: 'web' } */
export async function initPlatform() {
  if (!isNative()) return { platform: 'web' }
  if (!installed) {
    installed = import('./native/index.js')
      .then((m) => m.installNative())
      .catch((e) => {
        console.error('[platform] 原生适配安装失败，将退化为 Web 行为:', e)
        installed = null
        return { platform: 'web', error: String(e?.message || e) }
      })
  }
  return installed
}
