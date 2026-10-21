/**
 * 听歌统计（P7.3 G4）：在「音源真正开始播放」时记一条事件，
 * 播放过程中累积已听时长；内存实时更新 + 延迟持久化（bmp:listen-stats）。
 */
import { state, songKey, LS } from './state.js'
import { recordListen, addListenMs, statsSummary, STATS_MAX } from '../api/stats.js'

let persistTimer = null

function persistStats() {
  try {
    localStorage.setItem(LS.listenStats, JSON.stringify(state.listenStats))
  } catch {
    /* 超出配额时放弃持久化 */
  }
}

/** 播放中每 4 秒落一次盘（timeupdate 频率约 4Hz，避免频繁写 localStorage） */
function schedulePersist() {
  if (persistTimer) return
  persistTimer = setTimeout(() => {
    persistTimer = null
    persistStats()
  }, 4000)
}

/** 立即落盘（切歌 / 暂停 / 离开时调用） */
export function flushStats() {
  if (persistTimer) {
    clearTimeout(persistTimer)
    persistTimer = null
  }
  persistStats()
}

/** 播放开始：记一条收听事件（最新在前） */
export function recordListenStart(song, source = '') {
  if (!song) return
  state.listenStats = recordListen(
    state.listenStats,
    {
      key: songKey(song),
      name: song.name || '',
      singers: song.singers || [],
      cover: song.cover || state.matches[songKey(song)]?.cover || '',
      source: source || state.player.source || '',
      at: Date.now(),
      ms: 0,
    },
    STATS_MAX
  )
  schedulePersist()
}

/** 播放进度：累积当前歌曲已听时长（毫秒），仅内存更新 + 延迟落盘 */
export function recordListenProgress(ms) {
  const cur = state.listenStats[0]
  if (!cur) return
  if (addListenMs(state.listenStats, cur.key, ms)) schedulePersist()
}

/** 清空统计（内存 + 持久化） */
export function clearStats() {
  state.listenStats = []
  flushStats()
}

/** 汇总（days=0 全部；否则最近 N 天） */
export function statsFor(days = 0) {
  return statsSummary(state.listenStats, { days, now: Date.now() })
}
