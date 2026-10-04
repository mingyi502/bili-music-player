const PUNCT = /[【】\[\]（）()《》<>「」『』"'`.,!?、,~～\-_|/\\:：;；·•+&@#%^*=]/g
const OFFICIAL_RE = /mv|官方|official|pv|高清|4k|8k|hires|hi-?res|无损|原版|完整版|full/i

export function normalize(str) {
  return String(str || '')
    .toLowerCase()
    .replace(PUNCT, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokens(str) {
  return normalize(str)
    .split(' ')
    .filter((t) => t.length > 0)
}

export function parseDuration(str) {
  if (typeof str === 'number') return str
  const parts = String(str || '')
    .split(':')
    .map((n) => parseInt(n, 10) || 0)
  return parts.reduce((acc, n) => acc * 60 + n, 0)
}

export function isCandidate(video) {
  const sec = parseDuration(video.duration)
  return sec === 0 || (sec >= 20 && sec <= 20 * 60)
}

/** 计算视频与歌曲的匹配得分 */
export function scoreMatch(video, song) {
  const title = normalize(video.title)
  const name = normalize(song.name)
  const singers = (song.singers || []).map(normalize).filter(Boolean)
  let score = 0

  if (name && title.includes(name)) {
    score += 60
  } else {
    const nameTokens = tokens(song.name)
    if (nameTokens.length) {
      const hit = nameTokens.filter((t) => title.includes(t)).length
      score += (hit / nameTokens.length) * 45
    }
  }

  const singerHit = singers.filter((s) => s && title.includes(s)).length
  if (singerHit) {
    score += 30 - Math.max(0, singerHit - 1) * 4
  } else {
    const singerTokens = singers.flatMap(tokens)
    if (singerTokens.length) {
      const hit = singerTokens.filter((t) => title.includes(t)).length
      score += (hit / singerTokens.length) * 15
    }
  }

  if (OFFICIAL_RE.test(video.title)) score += 8
  score += Math.min(15, Math.log10((video.play || 0) + 1) * 3)
  return score
}

/** 时长越接近歌曲时长，得分越高（模糊匹配，不要求一致） */
export function scoreDuration(video, song) {
  const songSec = Number(song.interval) || 0
  const vidSec = parseDuration(video.duration)
  if (!songSec || !vidSec) return 0
  const diff = Math.abs(songSec - vidSec)
  if (diff <= 3) return 22
  if (diff <= 8) return 16
  if (diff <= 15) return 10
  if (diff <= 30) return 4
  if (diff > 90) return -12
  return 0
}

/** 时长加分只在已有文字命中时才生效，避免「不相关但时长凑巧一致」被误判为匹配 */
const DURATION_GATE = 30

function scoreWithDuration(video, song) {
  const base = scoreMatch(video, song)
  return base + (base >= DURATION_GATE ? scoreDuration(video, song) : 0)
}

export function rankCandidates(videos, song) {
  return videos
    .filter(isCandidate)
    .map((v) => ({ video: v, score: scoreWithDuration(v, song) }))
    .sort((a, b) => b.score - a.score)
    .map((x) => x.video)
}

/** 低于该分数视为没有合适的匹配，避免仅凭播放量错配 */
const MIN_SCORE = 35

export function pickBest(videos, song) {
  const ranked = videos
    .filter(isCandidate)
    .map((v) => ({ video: v, score: scoreWithDuration(v, song) }))
    .sort((a, b) => b.score - a.score)
  const top = ranked[0]
  if (!top || top.score < MIN_SCORE) return null
  return top.video
}

export function buildKeyword(song) {
  const singer = (song.singers || []).join(' ')
  return `${song.name} ${singer}`.trim()
}
