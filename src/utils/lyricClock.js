/**
 * 歌词时钟（iframe 内嵌源平滑用）。
 *
 * 内嵌 iframe 的播放时间每 500ms 才 +0.5s（2Hz，见 player.js 的 biliTimer），
 * 直接用它驱动逐字会有明显台阶；这里提供本地外推：以最后一次事件时间为基准，
 * 用 performance.now 插值（上限 maxMs），暂停 / seek / 切源 时由调用方重置基准。
 *
 * 仅纯函数部分放这里（平台层可单测）；rAF 驱动在 store/lyric.js（lyricNow）。
 */

/**
 * 外推时间。
 * @param {number} base 最后一次事件的时间（秒）
 * @param {number} atMs 事件发生时的 performance.now()
 * @param {number} nowMs 当前 performance.now()
 * @param {number} maxMs 外推上限（毫秒，避免暂停/卡顿时无限跑）
 * @returns {number} 外推后的时间（秒）
 */
export function extrapolateTime(base, atMs, nowMs, maxMs = 480) {
  const b = Number(base) || 0
  const dt = Math.max(0, (Number(nowMs) || 0) - (Number(atMs) || 0))
  const capped = Math.min(dt, Math.max(0, Number(maxMs) || 0))
  return b + capped / 1000
}
