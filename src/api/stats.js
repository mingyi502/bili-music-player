/**
 * 听歌统计纯函数（P7.3 G4）：事件结构
 * `{ key, name, singers: [], source, at: 毫秒时间戳, ms: 已听时长 }`，最新在前。
 * 只做计算，不碰 localStorage / state（便于平台层单测）。
 */

/** 事件条数上限（约可存一年高频收听） */
export const STATS_MAX = 5000

/** 追加一条收听事件（最新在前，超上限截断）；返回新数组 */
export function recordListen(list, event, cap = STATS_MAX) {
  const next = [event, ...(list || [])]
  return next.length > cap ? next.slice(0, cap) : next
}

/** 更新最近一条事件的已听时长（同一首才更新）；就地修改并返回是否更新 */
export function addListenMs(list, key, ms) {
  const cur = (list || [])[0]
  if (!cur || cur.key !== key) return false
  if (!(ms > (cur.ms || 0))) return false
  cur.ms = Math.round(ms)
  return true
}

function pad2(n) {
  return n < 10 ? `0${n}` : String(n)
}

/** 本地时区的「YYYY-MM-DD」 */
export function dayKey(ts) {
  const d = new Date(ts || 0)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

/**
 * 汇总统计。
 * @param {Array} events 收听事件（最新在前）
 * @param {{ days?: number, now?: number }} opts `days=0` 为全部；否则只看最近 N 天
 * @returns 总次数/总时长/独立歌曲/独立歌手/Top 歌曲/Top 歌手/时段分布/每日趋势
 */
export function statsSummary(events, { days = 0, now = Date.now() } = {}) {
  const since = days > 0 ? now - days * 86400000 : 0
  const inRange = (events || []).filter((e) => Number(e.at) >= since)

  const songMap = new Map()
  const singerMap = new Map()
  const byHour = new Array(24).fill(0)
  const byDayMap = new Map()
  let totalMs = 0

  for (const e of inRange) {
    const ms = Number(e.ms) || 0
    totalMs += ms
    const key = e.key || e.name || '?'
    let song = songMap.get(key)
    if (!song) {
      song = { key, name: e.name || '', singers: e.singers || [], plays: 0, ms: 0 }
      songMap.set(key, song)
    }
    song.plays += 1
    song.ms += ms
    for (const name of e.singers || []) {
      if (!name) continue
      singerMap.set(name, (singerMap.get(name) || 0) + 1)
    }
    byHour[new Date(Number(e.at) || 0).getHours()] += 1
    const day = dayKey(e.at)
    const d = byDayMap.get(day) || { day, plays: 0, ms: 0 }
    d.plays += 1
    d.ms += ms
    byDayMap.set(day, d)
  }

  const topSongs = [...songMap.values()].sort((a, b) => b.plays - a.plays || b.ms - a.ms).slice(0, 10)
  const topSingers = [...singerMap.entries()]
    .map(([name, plays]) => ({ name, plays }))
    .sort((a, b) => b.plays - a.plays || a.name.localeCompare(b.name))
    .slice(0, 10)
  const byDay = [...byDayMap.values()].sort((a, b) => (a.day < b.day ? -1 : 1)).slice(-14)

  return {
    totalPlays: inRange.length,
    totalMs,
    uniqueSongs: songMap.size,
    uniqueSingers: singerMap.size,
    topSongs,
    topSingers,
    byHour,
    byDay,
  }
}

/** 听歌时长人性化：`45 秒` / `23 分 10 秒` / `3 小时 05 分` */
export function formatListenDuration(ms) {
  const sec = Math.max(0, Math.round((Number(ms) || 0) / 1000))
  if (sec < 60) return `${sec} 秒`
  const min = Math.floor(sec / 60)
  const h = Math.floor(min / 60)
  if (h > 0) return `${h} 小时 ${pad2(min % 60)} 分`
  return `${min} 分 ${pad2(sec % 60)} 秒`
}
