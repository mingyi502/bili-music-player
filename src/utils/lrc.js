/**
 * LRC 歌词解析（平台无关，纯函数）。
 *
 * - parseLrc(text)                 → [{ time, text }] 按时间升序（含 [offset:] 修正）
 * - mergeTranslation(lines, text)  → 同时间戳的翻译行合并为 line.trans
 * - findLineIndex(lines, time)     → 当前应高亮行下标（-1 = 还没到第一句）
 */

const TAG_RE = /^\[(ti|ar|al|by|offset|length):(.*)\]$/i

export function parseLrc(text) {
  if (!text) return []
  const timeRe = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g
  const lines = []
  let offset = 0
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const tag = line.match(TAG_RE)
    if (tag) {
      if (tag[1].toLowerCase() === 'offset') {
        const n = Number(tag[2].trim())
        if (Number.isFinite(n)) offset = n / 1000
      }
      continue
    }
    timeRe.lastIndex = 0
    const stamps = []
    let m
    while ((m = timeRe.exec(line))) {
      const min = Number(m[1])
      const sec = Number(m[2])
      const frac = m[3] ? Number(`0.${m[3].padEnd(3, '0').slice(0, 3)}`) : 0
      stamps.push(min * 60 + sec + frac)
    }
    if (!stamps.length) continue
    const content = line.replace(timeRe, '').trim()
    // 同一行可能有多个时间戳（副歌复用）
    for (const t of stamps) lines.push({ time: Math.max(0, t - offset), text: content })
  }
  return lines.sort((a, b) => a.time - b.time)
}

const msKey = (t) => Math.round(t * 1000)

/** 翻译版权/来源声明行（QQ 的翻译 LRC 首行常见），不并入歌词 */
const TRANSLATION_CREDIT_RE = /享有本翻译作品的著作权|本翻译作品|^翻译[:：]|TME享有/

/** 把翻译 LRC 按时间戳合并进原文行（容差 50ms，QQ 的翻译偶有毫秒偏差） */
export function mergeTranslation(lines, transText) {
  const trans = parseLrc(transText)
  if (!trans.length) return lines
  const map = new Map()
  for (const t of trans) {
    // QQ 的翻译 LRC 用 `//` 占位（如「词：」「曲：」这类行没有翻译），跳过避免噪声
    if (!t.text || t.text === '//') continue
    if (TRANSLATION_CREDIT_RE.test(t.text)) continue
    if (!map.has(msKey(t.time))) map.set(msKey(t.time), t.text)
  }
  if (!map.size) return lines
  return lines.map((line) => {
    const key = msKey(line.time)
    let hit = map.get(key)
    if (!hit) {
      for (let d = 1; d <= 50 && !hit; d++) hit = map.get(key + d) || map.get(key - d)
    }
    return hit ? { ...line, trans: hit } : line
  })
}

/** 二分查找当前时间对应的行下标（-1 表示还没到第一句） */
export function findLineIndex(lines, time) {
  if (!lines?.length) return -1
  let lo = 0
  let hi = lines.length - 1
  let ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (lines[mid].time <= time) {
      ans = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return ans
}

/**
 * 歌词校准换算（S1）。
 * 约定：**正偏移 = 歌词延后**（补偿 B 站视频的前奏），负偏移 = 歌词提前。
 * - toLyricTime：播放时间 → 用于查行的「歌词时间」
 * - toSeekTime：歌词行时间 → 点击该行应 seek 到的播放时间（反算）
 */
export function toLyricTime(elapsedSec, offsetMs) {
  return (Number(elapsedSec) || 0) - (Number(offsetMs) || 0) / 1000
}

export function toSeekTime(lineTime, offsetMs) {
  return (Number(lineTime) || 0) + (Number(offsetMs) || 0) / 1000
}

/**
 * B 站视频与 QQ 原曲的时长差（秒）；超过阈值才返回差值，否则返回 0。
 * 用于提示「匹配到的可能是不同版本（live/剪辑），建议校准或换匹配」。
 */
export function lyricDurationMismatch(songInterval, videoDuration, threshold = 5) {
  const a = Number(songInterval) || 0
  const b = Number(videoDuration) || 0
  if (a <= 0 || b <= 0) return 0
  const diff = Math.abs(Math.round(a - b))
  return diff > threshold ? diff : 0
}
