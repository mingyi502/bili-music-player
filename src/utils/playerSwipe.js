/**
 * 全屏播放器手势判定。
 *
 * 之前下滑 70px 就收起，歌词列表本身是纵向滚动区域，上下划歌词很容易误触。
 * 现在：
 *  - 横向滑动（≥90px 且明显大于纵向）才切封面/歌词；
 *  - 歌词列表内的纵向滑动只滚动，不收起；
 *  - 其它区域下滑至少 140px（或屏幕高度 16%）且纵向占优才收起。
 */
export function decidePlayerSwipe({ dx = 0, dy = 0, inLyrics = false, height = 0 } = {}) {
  const absX = Math.abs(dx)
  const absY = Math.abs(dy)

  if (absX >= 90 && absX > absY * 1.8) {
    return dx < 0 ? 'lyrics' : 'cover'
  }
  if (inLyrics) return 'none'

  const threshold = Math.max(140, Number(height || 0) * 0.16)
  if (dy > threshold && dy > absX * 1.8) return 'collapse'
  return 'none'
}
