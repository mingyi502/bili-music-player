/**
 * seek 稳定性判定（平台无关，纯函数）。
 *
 * 大跨度 seek（如 30s+）需要重新缓冲，`timeupdate` 会在缓冲期间持续报告旧位置；
 * 在硬上限内一律忽略这些旧位置，让进度条停在目标处，缓冲完成后自然继续。
 * 音频元素的 `seeking` / `seeked` 事件由调用方结合使用（seeked 到达即结束结算）。
 */

/** 到达判定容差（秒）：报告位置与目标相差在此范围内即视为 seek 已生效 */
export const SEEK_TOLERANCE = 1.5
/** 重试判定（毫秒）：明显未到达且音频不再处于 seeking 状态时，重试一次 seek */
export const SEEK_SETTLE_MS = 2000
/** 硬上限（毫秒）：超过则接受现实（不可 seek 的源避免长时间显示假进度） */
export const SEEK_HARD_MS = 20000

/**
 * @param {number} reported `audioEl.currentTime`
 * @param {number|null} target seek 目标（null 表示当前没有待结算的 seek）
 * @param {number} sinceMs 距发起 seek 的毫秒数
 * @returns {boolean} true = 忽略这次 timeupdate（缓冲期的旧位置）
 */
export function shouldIgnoreStaleTimeUpdate(
  reported,
  target,
  sinceMs,
  { tolerance = SEEK_TOLERANCE, hardMs = SEEK_HARD_MS } = {}
) {
  if (target === null || target === undefined) return false
  const t = Number(target)
  if (!Number.isFinite(t)) return false
  const r = Number(reported) || 0
  if (Math.abs(r - t) <= tolerance) return false // 已到达 → 接受
  if (Number(sinceMs) >= hardMs) return false // 超过硬上限 → 接受现实
  return true // 缓冲/重试期间：保持目标位置
}
