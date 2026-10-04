/**
 * 歌词状态与加载（B1）。
 *
 * - 自动跟随当前曲：切歌 / 启动恢复队列时确保已加载
 * - 缓存：内存 Map + localStorage `bmp:lyric2:<songmid>`（命中不再请求）
 *   v2：musicu 接口带 `trans:1` 后才有翻译，旧 `bmp:lyric:` 缓存（无翻译）启动时清理
 * - 只对真实 QQ 歌曲（有 songmid）请求；失败不打断播放（state.lyric.error）
 */
import { computed, ref, watch } from 'vue'
import { state, songKey, LS, saveConfig } from './state.js'
import { currentSong, elapsed } from './player.js'
import { fetchLyric } from '../api/qq/lyric.js'
import { parseLrc, mergeTranslation } from '../utils/lrc.js'
import { parseQrc, mergeQrcExtra, markCreditLines } from '../utils/qrc.js'
import { extrapolateTime } from '../utils/lyricClock.js'

const CACHE_PREFIX = 'bmp:lyric4:'
const LEGACY_PREFIXES = ['bmp:lyric:', 'bmp:lyric2:', 'bmp:lyric3:']
const memCache = new Map()

// 一次性清理旧版歌词缓存（v1 无翻译；v2 无逐字/罗马音；v3 未过滤翻译版权行/未标记信息行）
try {
  for (const k of Object.keys(localStorage)) {
    if (LEGACY_PREFIXES.some((p) => k.startsWith(p)) && !k.startsWith(CACHE_PREFIX)) localStorage.removeItem(k)
  }
} catch {
  /* ignore */
}

const EMPTY = () => ({ key: '', lines: [], loading: false, error: '', source: '', qrc: false })

function cacheKeyOf(song) {
  const k = song?.mid || song?.id
  return k ? `${CACHE_PREFIX}${k}` : ''
}

function readCache(key) {
  if (memCache.has(key)) return memCache.get(key)
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const data = JSON.parse(raw)
    memCache.set(key, data)
    return data
  } catch {
    return null
  }
}

function writeCache(key, data) {
  memCache.set(key, data)
  try {
    localStorage.setItem(key, JSON.stringify(data))
  } catch {
    // 配额满：清掉所有歌词缓存再试一次，仍失败就放弃（不影响播放）
    try {
      for (const k of Object.keys(localStorage)) {
        if (k.startsWith(CACHE_PREFIX)) localStorage.removeItem(k)
      }
      localStorage.setItem(key, JSON.stringify(data))
    } catch {
      /* ignore */
    }
  }
}

/**
 * 确保当前歌词已加载（命中缓存直接返回）。
 * @param {{ mid?: string, name?: string }} song
 */
export async function loadLyric(song, { force = false } = {}) {
  const key = cacheKeyOf(song)
  if (!key) {
    state.lyric = EMPTY()
    return []
  }
  const songK = songKey(song)
  if (!force && state.lyric.key === songK && (state.lyric.loading || state.lyric.lines.length)) {
    return state.lyric.lines
  }
  const cached = force ? null : readCache(key)
  if (cached?.lines?.length) {
    // 旧缓存可能没有 credit 标记：命中时补一遍（纯函数、幂等）
    state.lyric = { key: songK, lines: markCreditLines(cached.lines, song), loading: false, error: '', source: 'cache', qrc: !!cached.qrc }
    return state.lyric.lines
  }
  // 没有 songmid（演示 / 本地歌曲）不发请求：只有 QQ 歌曲才可能拿到歌词
  if (!song.mid) {
    state.lyric = { key: songK, lines: [], loading: false, error: '暂无歌词', source: '', qrc: false }
    return []
  }
  state.lyric = { key: songK, lines: [], loading: true, error: '', source: '', qrc: false }
  try {
    const { lyric, trans, roma, qrc: hasQrc } = await fetchLyric(song.mid, state.config.qqCookie, state.config.uin)
    let qrc = hasQrc
    let lines = qrc ? parseQrc(lyric) : parseLrc(lyric)
    if (qrc && !lines.length) {
      // 逐字解析为空（接口给了 LRC 文本等情况）：按行级处理
      qrc = false
      lines = parseLrc(lyric)
    }
    lines = qrc ? mergeQrcExtra(mergeQrcExtra(lines, trans, 'trans'), roma, 'roma') : mergeTranslation(lines, trans)
    lines = markCreditLines(lines, song)
    if (state.lyric.key !== songK) return lines // 期间已切歌，不覆盖
    state.lyric = {
      key: songK,
      lines,
      loading: false,
      error: lines.length ? '' : '暂无歌词',
      source: 'network',
      qrc,
    }
    if (lines.length) writeCache(key, { lines, qrc, savedAt: Date.now() })
    return lines
  } catch (e) {
    if (state.lyric.key === songK) {
      state.lyric = { key: songK, lines: [], loading: false, error: e.message || '歌词加载失败', source: '', qrc: false }
    }
    return []
  }
}

/** 清空内存歌词缓存（调试 / 换号用） */
export function clearLyricMemCache() {
  memCache.clear()
}

/** 逐字高亮开关（P8.4，持久化在 config） */
export function setLyricQrc(v) {
  saveConfig({ lyricQrc: !!v })
}

// ---------------------------------------------------------------------------
// 歌词时钟（iframe 内嵌源 2Hz → 本地外推平滑，2026-09-27）
// 音频源直接用 elapsed（帧级插值）；iframe 播放中用最后一次 currentTime 事件 +
// rAF 外推（≤480ms），暂停 / seek / 切源 自动停止或复位基准。
// ---------------------------------------------------------------------------
const IFRAME_CLOCK_MAX_MS = 480
const clockNow = ref(0)
let clockRaf = null
let iframeBase = 0
let iframeAt = 0

const hasRaf = () => typeof requestAnimationFrame === 'function'

function startClock() {
  if (clockRaf || !hasRaf()) return
  const tick = () => {
    clockNow.value = performance.now()
    clockRaf = requestAnimationFrame(tick)
  }
  clockRaf = requestAnimationFrame(tick)
}
function stopClock() {
  if (!clockRaf) return
  if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(clockRaf)
  clockRaf = null
}
function resetIframeBase() {
  iframeBase = state.player.currentTime || 0
  iframeAt = typeof performance !== 'undefined' ? performance.now() : 0
  clockNow.value = iframeAt
}

watch(
  () => [state.player.source, state.player.playing],
  ([source, playing]) => {
    if (source === 'iframe' && playing) {
      resetIframeBase()
      startClock()
    } else {
      stopClock()
    }
  },
  { immediate: true }
)
watch(
  () => state.player.currentTime,
  (t) => {
    if (state.player.source !== 'iframe') return
    iframeBase = Number(t) || 0
    iframeAt = typeof performance !== 'undefined' ? performance.now() : 0
    clockNow.value = iframeAt
  }
)

/** 歌词用「当前时间」（秒，未加校准偏移）：音频源 = elapsed；iframe = 本地外推 */
export const lyricNow = computed(() => {
  if (state.player.source === 'iframe' && state.player.playing && hasRaf()) {
    return extrapolateTime(iframeBase, iframeAt, clockNow.value, IFRAME_CLOCK_MAX_MS)
  }
  return elapsed.value
})

/** 罗马音显示开关（P8.4，持久化在 config） */
export function setLyricRoma(v) {
  saveConfig({ lyricRoma: !!v })
}

// ---------------------------------------------------------------------------
// 歌词校准偏移（S1）：正 = 歌词延后（补偿 B 站视频前奏），单位 ms，按歌曲保存。
// ---------------------------------------------------------------------------
export const LYRIC_OFFSET_MAX = 30000

function offsetKeyOf(song) {
  const k = song?.mid || song?.id
  return k ? String(k) : ''
}

// 长按连续校准会高频调用：leading + trailing 节流写盘（首尾各写一次，中间跳过）
let offsetPersistTimer = null

function writeLyricOffset() {
  try {
    localStorage.setItem(LS.lyricOffset, JSON.stringify(state.lyricOffset))
  } catch {
    /* 配额异常不打断业务 */
  }
}

function persistLyricOffset() {
  if (offsetPersistTimer) return
  writeLyricOffset()
  offsetPersistTimer = setTimeout(() => {
    offsetPersistTimer = null
    writeLyricOffset()
  }, 300)
}

function flushLyricOffset() {
  if (offsetPersistTimer) {
    clearTimeout(offsetPersistTimer)
    offsetPersistTimer = null
  }
  writeLyricOffset()
}

/** 某首歌的校准偏移（ms，默认 0） */
export function lyricOffsetFor(song) {
  const key = offsetKeyOf(song)
  const v = key ? Number(state.lyricOffset[key]) : 0
  return Number.isFinite(v) ? v : 0
}

/** 调整偏移（deltaMs 可正可负），夹取到 ±30s；返回新值 */
export function setLyricOffset(song, deltaMs) {
  const key = offsetKeyOf(song)
  if (!key) return 0
  const next = Math.max(-LYRIC_OFFSET_MAX, Math.min(LYRIC_OFFSET_MAX, lyricOffsetFor(song) + (Number(deltaMs) || 0)))
  if (next === 0) delete state.lyricOffset[key]
  else state.lyricOffset[key] = next
  persistLyricOffset()
  return next
}

/** 重置某首歌的校准偏移 */
export function resetLyricOffset(song) {
  const key = offsetKeyOf(song)
  if (!key) return
  delete state.lyricOffset[key]
  flushLyricOffset()
}

// 自动跟随当前曲（切歌 / 启动恢复队列时）
watch(
  () => songKey(currentSong.value || {}),
  () => {
    const song = currentSong.value
    if (!song) return
    loadLyric(song)
  },
  { immediate: true }
)
