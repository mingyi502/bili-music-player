/**
 * 原生返回键适配（仅 Capacitor 容器）。
 * 业务层不直接 import @capacitor/*，统一从这里注入。
 */
import { App } from '@capacitor/app'

export async function installBackButton(handler) {
  return App.addListener('backButton', () => handler(App))
}

export function minimizeApp() {
  return App.minimizeApp()
}
