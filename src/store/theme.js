/**
 * 主题（P8.1 H1）：`system | light | dark`，持久化到 `bmp:config.theme`。
 * 生效方式：<html data-theme="light|dark">，CSS 变量在 :root 与 [data-theme='light'] 两套。
 */
import { state, saveConfig } from './state.js'

export const THEMES = ['system', 'light', 'dark']

/** 解析实际生效主题（纯函数，便于单测）：system 时跟随系统偏好 */
export function resolveTheme(theme, prefersLight = false) {
  if (theme === 'light' || theme === 'dark') return theme
  return prefersLight ? 'light' : 'dark'
}

function systemPrefersLight() {
  return typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: light)').matches : false
}

let media = null

function onSystemChange() {
  applyTheme('system')
}

/** 把主题应用到 <html>（非浏览器环境只计算不落 DOM） */
export function applyTheme(theme = state.config.theme || 'system') {
  const resolved = resolveTheme(theme, systemPrefersLight())
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.dataset.theme = resolved
  }
  return resolved
}

/** 设置主题：持久化 + 立即生效；system 时监听系统主题变化 */
export function setTheme(theme) {
  const t = THEMES.includes(theme) ? theme : 'system'
  saveConfig({ theme: t })
  applyTheme(t)
  if (media) {
    media.removeEventListener?.('change', onSystemChange)
    media = null
  }
  if (t === 'system' && typeof matchMedia === 'function') {
    media = matchMedia('(prefers-color-scheme: light)')
    media.addEventListener?.('change', onSystemChange)
  }
  return t
}

/** 启动时应用（main.js 挂载前调用）；返回实际生效主题 */
export function initTheme() {
  const t = state.config.theme || 'system'
  setTheme(t)
  return applyTheme(t)
}
