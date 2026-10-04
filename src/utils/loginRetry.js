/**
 * 登录重试策略（平台无关，纯函数）。
 *
 * 背景（F1–F3，2026-09-26）：
 *  - 扫码轮询遇到一次网络抖动就永久停止，需要手动刷新二维码；
 *  - 二维码生成失败没有自动重试，且英文报错（Failed to fetch）直出；
 *  - App 被系统冻结回到前台后没有补轮询，存在空窗。
 * 这里集中定义重试上限与文案映射，供 LoginDialog 与测试共用。
 */

/** 轮询连续失败上限：在此之前保持「等待扫码」状态持续重试，达到后才落错误态 */
export const POLL_RETRY_MAX = 5
/** 生成二维码的尝试次数（含首次） */
export const START_RETRY_MAX = 3

/** 生成二维码失败后的重试退避（毫秒）：第 1 次失败等 800ms，第 2 次 1600ms */
export function startRetryDelay(attempt, unit = 800) {
  return unit * Math.max(1, Number(attempt) || 1)
}

/** 轮询连续失败时的提示文案（failCount 为 1 基计数，展示时夹取到上限） */
export function pollRetryMessage(failCount, max = POLL_RETRY_MAX) {
  const n = Math.min(Math.max(1, Number(failCount) || 1), max)
  return `网络异常，正在重试（${n}/${max}）…`
}

/**
 * 底层错误 → 可读中文。
 * - 超时类（AbortError / timeout）→ 超时提示
 * - 网络类（Failed to fetch / NetworkError / fetch failed…）→ 网络连接提示
 * - 已是中文（含服务端返回的文案）→ 原样返回
 * - 其它（英文 / 未知）→ `${fallback}：raw`
 */
export function friendlyLoginError(raw, fallback = '登录失败') {
  const s = String(raw == null ? '' : raw).trim()
  if (!s) return fallback
  if (/AbortError|timeout|超时/i.test(s)) return '请求超时，请检查网络后重试'
  if (
    /Failed to fetch|NetworkError|fetch failed|Load failed|ERR_|Network request failed|Unable to resolve host|No address associated|UnknownHost|Network is unreachable|ENETUNREACH|ECONNREFUSED|Connection refused|Failed to connect/i.test(
      s
    )
  ) {
    return '网络连接失败，请检查网络或代理后重试'
  }
  if (/[\u4e00-\u9fa5]/.test(s)) return s
  return `${fallback}：${s}`
}
