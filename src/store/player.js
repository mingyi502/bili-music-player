/**
 * 播放器：播放引擎（<audio> / 内嵌 iframe）、音源策略（默认 B 站）、B 站匹配、播放控制。
 */
import { computed } from 'vue'
import { state, songKey, LS, persistMatches, saveConfig } from './state.js'
import { toast } from './ui.js'
import { pushError } from './errors.js'
import { fetchSongUrl, fetchSongUrlInfo } from '../api/qq.js'
import { searchVideo, playerUrl, fetchBiliAudio } from '../api/bilibili.js'
import { pickBest, rankCandidates, parseDuration, buildKeyword } from '../utils/match.js'
import { shouldIgnoreStaleTimeUpdate, SEEK_SETTLE_MS } from '../utils/seek.js'
import { recordListenStart, recordListenProgress, flushStats } from './stats.js'

// ---------------------------------------------------------------------------
// 播放器：优先 QQ 音乐直链（<audio>，可精确同步进度/暂停/拖动），
// 拿不到直链时回退到 B 站音源（隐藏 iframe，仅出声，不出现视频界面）。
// ---------------------------------------------------------------------------
let audioEl = null
let biliIframe = null
let biliTimer = null
// 播放令牌：切歌/暂停时自增，让在途的异步播放流程作废，避免「暂停后又被自动播放」
let playSeq = 0

// ── 帧级插值（S3）：timeupdate 约 250ms 一次，用 rAF 在两次事件之间外推时间，
//    让歌词高亮与进度条更跟手；后台/暂停时自动回退到 currentTime。
let smoothRaf = null
let tickBase = 0 // 最近一次 timeupdate 的 audioEl.currentTime
let tickAt = 0 // 最近一次 timeupdate 的 performance.now()
const SMOOTH_MAX_EXTRAPOLATE_MS = 500

// seek 结算：缓冲期间 timeupdate 仍会报告旧位置，窗口内忽略偏离目标的更新，
// 避免「先跳到目标、又弹回原位」；窗口到期重试一次 seek。
let seekTarget = null
let seekAt = 0
let seekRetried = false

function clearSeekSettle() {
  seekTarget = null
  seekRetried = false
}

function stopSmoothTicker() {
  if (smoothRaf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(smoothRaf)
  smoothRaf = null
  state.player.smoothTime = 0
}

function startSmoothTicker() {
  if (smoothRaf || typeof requestAnimationFrame !== 'function') return
  const tick = () => {
    smoothRaf = requestAnimationFrame(tick)
    if (!isAudioSource() || !state.player.playing || !audioEl) return
    // seek 未落定（缓冲中）：停在目标位置，不回弹也不假前进
    if (seekTarget !== null) {
      if (state.player.smoothTime !== seekTarget) state.player.smoothTime = seekTarget
      return
    }
    const extra = Math.min(Math.max(performance.now() - tickAt, 0), SMOOTH_MAX_EXTRAPOLATE_MS)
    const t = tickBase + extra / 1000
    if (Math.abs(t - state.player.smoothTime) >= 0.03) state.player.smoothTime = t
  }
  smoothRaf = requestAnimationFrame(tick)
}

/** 音频元素当前时间作为插值基准（timeupdate / seek 后调用） */
function markTickBase() {
  if (!audioEl) return
  tickBase = audioEl.currentTime
  tickAt = performance.now()
  state.player.smoothTime = tickBase
}

/** 哪些音源是「真正的音频元素」（可精确 seek / 判断结束） */
function isAudioSource() {
  // local = 本地文件（下载/导入），同样是 <audio> 可控音源
  return state.player.source === 'qq' || state.player.source === 'bili' || state.player.source === 'local'
}

function ensureAudio() {
  if (audioEl) return audioEl
  audioEl = new Audio()
  audioEl.preload = 'auto'
  audioEl.addEventListener('timeupdate', () => {
    if (!isAudioSource()) return
    const reported = audioEl.currentTime
    if (seekTarget !== null) {
      const since = performance.now() - seekAt
      if (shouldIgnoreStaleTimeUpdate(reported, seekTarget, since)) {
        // 缓冲/重试期间：保持目标位置，不弹回
        if (!seekRetried && !audioEl.seeking && since >= SEEK_SETTLE_MS) {
          seekRetried = true
          seekAt = performance.now()
          try {
            audioEl.currentTime = seekTarget
          } catch {
            /* ignore */
          }
        }
        return
      }
      clearSeekSettle()
    }
    markTickBase()
    state.player.currentTime = reported
    if (isFinite(audioEl.duration) && audioEl.duration > 0) state.player.duration = audioEl.duration
    // 听歌统计（G4）：累积当前歌曲已听时长
    recordListenProgress(reported * 1000)
  })
  // seek 真正完成（数据到位）：立即结束结算并按真实位置刷新
  audioEl.addEventListener('seeked', () => {
    if (!isAudioSource() || seekTarget === null) return
    clearSeekSettle()
    markTickBase()
    state.player.currentTime = audioEl.currentTime
  })
  audioEl.addEventListener('loadedmetadata', () => {
    if (isAudioSource() && isFinite(audioEl.duration)) state.player.duration = audioEl.duration
  })
  audioEl.addEventListener('ended', () => next(true))
  audioEl.addEventListener('error', () => {
    if (!isAudioSource() || !state.player.playing) return
    const seq = ++playSeq
    const song = currentSong.value
    if (state.player.source === 'qq') {
      // QQ 直链失败 → 改用 B 站音频流
      state.player.fallbackReason = 'QQ 音乐直链不可用，已改用 B 站音源'
      tryBiliAudioThenIframe(song, state.player.index, seq)
    } else {
      // B 站音频流失败 → 兜底内嵌播放
      state.player.fallbackReason = 'B 站音频流不可用，已改用内嵌播放（不可拖动进度）'
      playViaBiliIframe(song, state.player.index, seq)
    }
  })
  return audioEl
}

function stopBili() {
  if (biliTimer) {
    clearInterval(biliTimer)
    biliTimer = null
  }
  if (biliIframe) {
    biliIframe.remove()
    biliIframe = null
  }
}

/** 用 <audio> 播放（QQ 直链 / B 站音频流通用），可拖进度 */
function playAudioSource(url, source, song, seq) {
  if (seq !== playSeq) return
  const audio = ensureAudio()
  stopBili()
  clearSeekSettle()
  audio.src = url
  state.player.source = source
  state.player.loading = false
  state.player.loadingText = ''
  state.player.playing = true
  state.player.currentTime = 0
  state.player.duration = song?.interval || 0
  audio.play().catch(() => {
    /* 自动播放被拦截时，用户点播放键即可 */
  })
  markTickBase()
  startSmoothTicker()
  // 音源真正开始播放 → 记入「最近播放」与「听歌统计」（纯本地）
  recordHistory(song)
  recordListenStart(song, source)
}

/** 匹配失败后多久内不再自动重试（用户仍可手动点「重新匹配」） */
const MATCH_RETRY_COOLDOWN = 5 * 60 * 1000

// 进行中的匹配请求（按歌曲 key），用于去重
const matchInflight = new Map()

/** 确保拿到匹配（复用进行中的请求，不重复发） */
async function ensureMatch(song) {
  const key = songKey(song)
  const m = state.matches[key]
  if (m?.status === 'ok') return m
  if (m?.status === 'loading') {
    await matchInflight.get(key)
    return state.matches[key]
  }
  // 刚失败过就别每次都重搜：否则每点一次歌都会重新打一轮 B 站搜索
  if (m?.status === 'error' && m.failedAt && Date.now() - m.failedAt < MATCH_RETRY_COOLDOWN) {
    return m
  }
  await matchSong(song, { silent: true })
  return state.matches[key]
}

/** 尝试用 B 站音频流播放；失败返回 false */
async function tryBiliAudio(song, index, seq) {
  if (!song) return false
  const match = await ensureMatch(song)
  if (seq !== playSeq || state.player.index !== index) return true
  if (!match?.bvid) return false
  try {
    const url = await fetchBiliAudio(match.bvid, state.config.biliCookie)
    if (seq !== playSeq) return true
    playAudioSource(url, 'bili', song, seq)
    return true
  } catch (e) {
    pushError('B站音频流', e.message)
    return false
  }
}

async function tryBiliAudioThenIframe(song, index, seq) {
  const ok = await tryBiliAudio(song, index, seq)
  if (seq !== playSeq) return
  if (!ok) await playViaBiliIframe(song, index, seq)
}

/** 兜底：隐藏 iframe 内嵌播放（出声，但无法控制进度） */
async function playViaBiliIframe(song, index = state.player.index, seq = playSeq, { startAt = 0, record = true } = {}) {
  if (!song) return
  const match = await ensureMatch(song)
  // 期间用户可能已切歌或暂停，避免把旧歌的 iframe 挂上去
  if (seq !== playSeq || state.player.index !== index) return
  if (!match || match.status !== 'ok' || !match.bvid) {
    state.player.loading = false
    state.player.loadingText = ''
    state.player.playing = false
    state.player.source = 'none'
    toast(`《${song.name}》：没有可用的音源（B 站未匹配到，QQ 也无直链）`, 'error')
    return
  }
  stopBili()
  stopSmoothTicker()
  clearSeekSettle()
  if (audioEl) audioEl.pause()
  state.player.source = 'iframe'
  state.player.loading = false
  state.player.loadingText = ''
  state.player.playing = true
  state.player.currentTime = Math.max(0, Number(startAt) || 0)
  state.player.duration = parseDuration(match.duration) || song.interval || 0
  const iframe = document.createElement('iframe')
  iframe.setAttribute('scrolling', 'no')
  iframe.setAttribute('frameborder', '0')
  iframe.setAttribute('allow', 'autoplay')
  iframe.style.cssText =
    'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;pointer-events:none;border:0;'
  iframe.src = playerUrl(match.bvid, 1, state.player.currentTime)
  document.body.appendChild(iframe)
  biliIframe = iframe
  // 内嵌播放同样算「播放过」（定位重载不算）
  if (record) {
    recordHistory(song)
    recordListenStart(song, 'iframe')
  }
  biliTimer = setInterval(() => {
    if (state.player.playing && state.player.source === 'iframe') {
      state.player.currentTime += 0.5
      recordListenProgress(state.player.currentTime * 1000)
      if (state.player.duration && state.player.currentTime >= state.player.duration) next(true)
    }
  }, 500)
}

/** iframe 兜底音源：重载到指定时间（点歌词 / 恢复播放用；带 t= 参数） */
async function reloadIframeAt(seconds) {
  const song = currentSong.value
  if (!song) return
  const seq = ++playSeq
  await playViaBiliIframe(song, state.player.index, seq, { startAt: seconds, record: false })
}

function stopTicker() {
  stopSmoothTicker()
  stopBili()
}

/** 账号切换：停掉声音与定时器，但不改动播放状态（后续由登录流程重置） */
export function haltPlayback() {
  stopTicker()
  if (audioEl) audioEl.pause()
}

/** 登出：彻底释放音频元素 */
export function releaseAudio() {
  if (audioEl) audioEl.src = ''
  stopTicker()
  flushStats()
}

// ---------------------------------------------------------------------------
// 播放队列：显式维护播放顺序；歌单/专辑加载时自动灌入，用户可「下一首播放」、
// 拖动排序、移除、清空。队列持久化到 bmp:queue（下次打开可继续）。
// ---------------------------------------------------------------------------
const QUEUE_MAX = 500

function persistQueue() {
  try {
    localStorage.setItem(
      LS.queue,
      JSON.stringify({
        songs: state.queue.slice(0, QUEUE_MAX).map((e) => e.song),
        index: state.player.queueIndex,
        savedAt: Date.now(),
      })
    )
  } catch {
    /* 超出配额时放弃持久化 */
  }
}

/** 用当前歌单重建队列（加载歌单/专辑/我喜欢时调用） */
export function setQueueFromSongs(songs) {
  state.queue = (songs || []).map((song) => ({ key: songKey(song), song, from: 'list' }))
  state.player.queueIndex = -1
  persistQueue()
}

/** 登录/登出时清空队列（不暂停、不提示） */
export function resetQueue() {
  state.queue = []
  state.player.queueIndex = -1
  persistQueue()
}

/** 加入下一首播放（同一首歌会从原位置移到当前曲之后） */
export function playNext(song) {
  if (!song) return
  const entry = { key: songKey(song), song, from: 'manual' }
  const currentKey = state.queue[state.player.queueIndex]?.key
  const existing = state.queue.findIndex((e) => e.key === entry.key)
  if (existing >= 0) state.queue.splice(existing, 1)
  // 删除后当前项下标可能变化，按 key 重新定位
  const curIdx = currentKey ? state.queue.findIndex((e) => e.key === currentKey) : -1
  state.player.queueIndex = curIdx
  const at = curIdx >= 0 ? curIdx + 1 : 0
  state.queue.splice(at, 0, entry)
  persistQueue()
  toast(`已加入下一首播放：${song.name}`, 'success')
}

/** 追加到队列末尾 */
export function addToQueue(song) {
  if (!song) return
  const key = songKey(song)
  if (state.queue.some((e) => e.key === key)) {
    toast('已在播放队列中', 'info')
    return
  }
  state.queue.push({ key, song, from: 'manual' })
  persistQueue()
  toast(`已加入播放队列：${song.name}`, 'success')
}

/**
 * 批量追加到队尾（跳过已存在，不弹 toast），供私人 FM 连续补歌用。
 * @returns {Array<{ key: string, song: object }>} 实际追加的条目
 */
export function appendToQueue(songs) {
  const added = []
  for (const song of songs || []) {
    if (!song) continue
    const key = songKey(song)
    if (state.queue.some((e) => e.key === key)) continue
    state.queue.push({ key, song, from: 'fm' })
    added.push({ key, song })
  }
  if (added.length) persistQueue()
  return added
}

/** 从队列移除某一项；移除当前曲会停止播放 */
export function removeFromQueue(index) {
  if (index < 0 || index >= state.queue.length) return
  const removingCurrent = index === state.player.queueIndex
  state.queue.splice(index, 1)
  if (removingCurrent) {
    pause()
    state.player.index = -1
    state.player.source = 'none'
    state.player.currentTime = 0
    state.player.duration = 0
    if (state.player.queueIndex >= state.queue.length) state.player.queueIndex = state.queue.length - 1
  } else if (index < state.player.queueIndex) {
    state.player.queueIndex--
  }
  persistQueue()
}

/** 拖动排序（当前曲的位置会跟着移动） */
export function moveQueueItem(from, to) {
  const q = state.queue
  if (from === to || from < 0 || to < 0 || from >= q.length || to >= q.length) return
  const [item] = q.splice(from, 1)
  q.splice(to, 0, item)
  const cur = state.player.queueIndex
  if (cur === from) state.player.queueIndex = to
  else if (from < cur && to >= cur) state.player.queueIndex--
  else if (from > cur && to <= cur) state.player.queueIndex++
  persistQueue()
}

/** 清空队列并停止播放 */
export function clearQueue() {
  pause()
  state.queue = []
  state.player.queueIndex = -1
  state.player.index = -1
  state.player.source = 'none'
  state.player.currentTime = 0
  state.player.duration = 0
  persistQueue()
  toast('已清空播放队列', 'success')
}

/** 播放队列中的第 i 首（队列面板点击行） */
export async function playQueueItem(index) {
  await playQueueAt(index)
}

async function playQueueAt(queueIndex) {
  const entry = state.queue[queueIndex]
  if (!entry) return
  const rowIndex = state.songs.findIndex((s) => songKey(s) === entry.key)
  state.player.queueIndex = queueIndex
  const seq = ++playSeq
  await startPlayback(entry.song, rowIndex, seq)
  persistQueue()
}

const currentSong = computed(() => {
  const entry = state.queue[state.player.queueIndex]
  if (entry?.song) return entry.song
  return state.player.index >= 0 ? state.songs[state.player.index] || null : null
})

// ---------------------------------------------------------------------------
// 最近播放（纯本地，与 QQ 账号数据无关）：
// 「音源真正开始播放」时记录（playAudioSource / playViaBiliIframe），
// 同一首只保留最新一条，上限 HISTORY_MAX。
// ---------------------------------------------------------------------------
const HISTORY_MAX = 200

function persistHistory() {
  try {
    localStorage.setItem(LS.history, JSON.stringify(state.history))
  } catch {
    /* 超出配额时放弃持久化 */
  }
}

/** 播放过即记录；重复播放只更新时间戳并移到最前 */
export function recordHistory(song) {
  if (!song) return
  const key = songKey(song)
  const i = state.history.findIndex((h) => h.key === key)
  if (i >= 0) state.history.splice(i, 1)
  state.history.unshift({ key, song, playedAt: Date.now() })
  if (state.history.length > HISTORY_MAX) state.history.length = HISTORY_MAX
  persistHistory()
}

/** 清空最近播放 */
export function clearHistory() {
  state.history = []
  persistHistory()
  toast('已清空最近播放', 'success')
}

/**
 * 用「本地队列」播放（最近播放等）：不改 state.songs / state.playlist，
 * player.index = -1（不在主列表中），主列表与侧栏状态不受影响。
 */
export async function playLocalQueue(songs, index) {
  if (!Array.isArray(songs) || index < 0 || index >= songs.length) return
  state.queue = songs.map((song) => ({ key: songKey(song), song, from: 'local' }))
  state.player.queueIndex = index
  const seq = ++playSeq
  await startPlayback(songs[index], -1, seq)
  persistQueue()
}

// ---------------------------------------------------------------------------
// 睡眠定时（A6）：到点自动暂停；不持久化（刷新 / 重开即失效）。
// ---------------------------------------------------------------------------
let sleepTicker = null

function stopSleepTicker() {
  if (sleepTicker) {
    clearInterval(sleepTicker)
    sleepTicker = null
  }
}

/** 开启睡眠定时（minutes 支持小数，便于测试） */
export function setSleepTimer(minutes) {
  const m = Number(minutes)
  if (!Number.isFinite(m) || m <= 0) return
  state.sleep.minutes = m
  state.sleep.endsAt = Date.now() + m * 60e3
  state.sleep.remaining = Math.round(m * 60)
  stopSleepTicker()
  sleepTicker = setInterval(() => {
    const left = Math.max(0, Math.ceil((state.sleep.endsAt - Date.now()) / 1000))
    state.sleep.remaining = left
    if (left <= 0) {
      stopSleepTicker()
      state.sleep = { minutes: 0, endsAt: 0, remaining: 0 }
      pause()
      toast('睡眠定时已到，已暂停播放', 'info')
    }
  }, 1000)
  toast(`睡眠定时已开启：${m >= 1 ? `${m} 分钟` : `${Math.round(m * 60)} 秒`}后暂停`, 'success')
}

/** 关闭睡眠定时 */
export function cancelSleepTimer() {
  if (!state.sleep.endsAt) return
  stopSleepTicker()
  state.sleep = { minutes: 0, endsAt: 0, remaining: 0 }
  toast('已关闭睡眠定时', 'info')
}

const currentMatch = computed(() => {
  const song = currentSong.value
  if (!song) return null
  return state.matches[songKey(song)] || null
})
const currentVideo = computed(() => {
  const m = currentMatch.value
  return m && m.status === 'ok' ? m : null
})
const currentDuration = computed(() => state.player.duration || currentSong.value?.interval || 0)
const elapsed = computed(() => {
  // 音频源播放中优先用帧级插值时间（S3），其余情况用最近一次事件的精确值
  const base = state.player.currentTime || 0
  const t =
    isAudioSource() && state.player.playing && state.player.smoothTime > 0
      ? Math.max(base, state.player.smoothTime)
      : base
  return Math.min(t, currentDuration.value || 0)
})
const progress = computed(() => {
  const total = currentDuration.value
  if (!total) return 0
  return Math.min(100, (elapsed.value / total) * 100)
})
const matchedCount = computed(
  () => state.songs.filter((s) => state.matches[songKey(s)]?.status === 'ok').length
)

function applyMatch(key, video, extra = {}) {  state.matches[key] = video
    ? {
        status: 'ok',
        bvid: video.bvid,
        title: video.title,
        author: video.author,
        play: video.play,
        duration: video.duration,
        cover: video.cover,
        url: video.url,
        ...extra,
      }
    : { status: 'none', ...extra }
}

export async function searchCandidates(song, keyword) {
  const kw = keyword?.trim() || buildKeyword(song)
  const list = await searchVideo(kw, state.config.biliCookie)
  let ranked = rankCandidates(list, song)
  const best = pickBest(list, song)
  if (best) return { ranked, best }

  // 关键词没匹配上时，退化为「歌名」「歌名+主唱」再试，提高召回
  const alternates = [song.name, `${song.name} ${(song.singers || [])[0] || ''}`.trim()]
  for (const alt of alternates) {
    if (!alt || alt === kw) continue
    try {
      const l2 = await searchVideo(alt, state.config.biliCookie)
      const b2 = pickBest(l2, song)
      const r2 = rankCandidates(l2, song)
      if (b2) return { ranked: r2.length ? r2 : ranked, best: b2 }
      if (!ranked.length && r2.length) ranked = r2
    } catch {
      /* 忽略，继续下一个 */
    }
  }
  return { ranked, best: null }
}

export async function matchSong(song, { silent = false } = {}) {
  const key = songKey(song)
  // 去重：同一首歌已有匹配在途时复用，避免 matchAll 与播放回退重复请求
  if (matchInflight.has(key)) return matchInflight.get(key)
  const keyword = buildKeyword(song)
  state.matches[key] = { status: 'loading', keyword }
  const task = (async () => {
    try {
      const { ranked, best } = await searchCandidates(song, keyword)
      applyMatch(key, best, { keyword, candidates: ranked.slice(0, 8), manual: false })
      persistMatches()
      return best
    } catch (e) {
      const msg = e.message || '匹配失败'
      // 区分「网络/超时」与「接口/风控」错误，便于统计与提示
      const kind = /超时|timeout|Failed to fetch|请求失败|502|504|500/.test(msg) ? 'network' : 'api'
      state.matches[key] = { status: 'error', error: msg, keyword, errorKind: kind, failedAt: Date.now() }
      if (!silent) toast(`${song.name}: ${msg}`, 'error')
      return null
    }
  })().finally(() => matchInflight.delete(key))
  matchInflight.set(key, task)
  return task
}

export async function matchAll(concurrency = 2) {
  // 并发保护：已在匹配中则忽略重复点击，避免两轮同时跑导致进度错乱
  if (state.loading.matching) {
    toast('匹配正在进行中，请稍候', 'info')
    return
  }
  const songs = state.songs
  state.loading.matching = true
  state.loading.matchDone = 0
  state.loading.matchTotal = songs.length
  let cursor = 0
  async function worker() {
    while (cursor < songs.length) {
      const song = songs[cursor++]
      const existing = state.matches[songKey(song)]
      // 已匹配成功的直接跳过并计入进度，避免重复请求与计数错乱
      if (existing?.status === 'ok') {
        state.loading.matchDone++
        continue
      }
      await matchSong(song, { silent: true })
      state.loading.matchDone++
      // 轻微节流，降低被 B 站限流的概率
      await new Promise((r) => setTimeout(r, 150))
    }
  }
  try {
    await Promise.all(Array.from({ length: Math.min(concurrency, songs.length) }, worker))
    const netErrors = songs.filter((s) => state.matches[songKey(s)]?.errorKind === 'network').length
    toast(`匹配完成，成功 ${matchedCount.value}/${songs.length}`, 'success')
    if (netErrors >= 5) {
      toast(
        `有 ${netErrors} 首因网络超时失败：B站请求被拦截或代理节点不稳，可给 B站/QQ 域名加 DIRECT 规则（详见 SECURITY.md）`,
        'error'
      )
    }
  } finally {
    state.loading.matching = false
  }
}

export async function rematchSingle(song, keyword) {
  const key = songKey(song)
  state.matches[key] = { status: 'loading', keyword: keyword || buildKeyword(song) }
  try {
    const { ranked, best } = await searchCandidates(song, keyword)
    // 只有真正匹配到才标记为 manual（否则会被 matchAll 当成已完成而永久跳过）
    applyMatch(key, best, {
      keyword: keyword || buildKeyword(song),
      candidates: ranked.slice(0, 12),
      manual: Boolean(best),
    })
    persistMatches()
    toast(best ? `已重新匹配：${best.title}` : '没有找到合适的视频', best ? 'success' : 'error')
  } catch (e) {
    state.matches[key] = { status: 'error', error: e.message }
    toast(e.message, 'error')
  }
}

export function setMatch(song, video) {
  const key = songKey(song)
  const prev = state.matches[key] || {}
  applyMatch(key, video, { keyword: prev.keyword || buildKeyword(song), candidates: prev.candidates || [], manual: true })
  persistMatches()
}

export async function openCandidateDialog(song) {
  const key = songKey(song)
  const prev = state.matches[key] || {}
  const requestId = (state.candidateDialog.requestId || 0) + 1
  state.candidateDialog = {
    open: true,
    songKey: key,
    songName: song.name,
    keyword: prev.keyword || buildKeyword(song),
    loading: true,
    list: [],
    requestId,
  }
  try {
    const { ranked } = await searchCandidates(song, state.candidateDialog.keyword)
    if (state.candidateDialog.requestId !== requestId) return
    state.candidateDialog.list = ranked.slice(0, 20)
  } catch (e) {
    if (state.candidateDialog.requestId === requestId) toast(e.message, 'error')
  } finally {
    if (state.candidateDialog.requestId === requestId) state.candidateDialog.loading = false
  }
}

export async function searchInDialog(keyword) {
  state.candidateDialog.keyword = keyword
  state.candidateDialog.loading = true
  const requestId = (state.candidateDialog.requestId || 0) + 1
  state.candidateDialog.requestId = requestId
  try {
    const song = state.songs.find((s) => songKey(s) === state.candidateDialog.songKey)
    const { ranked } = await searchCandidates(song, keyword)
    if (state.candidateDialog.requestId !== requestId) return
    state.candidateDialog.list = ranked.slice(0, 20)
  } catch (e) {
    if (state.candidateDialog.requestId === requestId) toast(e.message, 'error')
  } finally {
    if (state.candidateDialog.requestId === requestId) state.candidateDialog.loading = false
  }
}

export function closeCandidateDialog() {
  state.candidateDialog.open = false
}

/**
 * 这首歌该用哪个音源：单曲覆盖 > 全局默认（默认 B 站）。
 * 用户可以在播放器上切换，切换结果会被记住。
 */
export function sourceFor(song) {
  if (!song) return state.config.defaultSource || 'bili'
  return state.sourcePref[songKey(song)] || state.config.defaultSource || 'bili'
}

function persistSourcePref() {
  try {
    localStorage.setItem(LS.sourcePref, JSON.stringify(state.sourcePref))
  } catch {
    /* 配额异常不打断业务 */
  }
}

/** 设定某首歌的音源偏好并立即重播（用户在播放器上点击切换） */
export async function useSource(song, source) {
  if (!song || (source !== 'qq' && source !== 'bili')) return
  state.sourcePref[songKey(song)] = source
  persistSourcePref()
  const idx = state.songs.findIndex((s) => songKey(s) === songKey(song))
  if (idx >= 0) await playIndex(idx)
}

/** 在当前播放的歌曲上切换音源（B站 ⇄ QQ） */
export async function switchCurrentSource() {
  const song = currentSong.value
  if (!song) return
  const next = sourceFor(song) === 'qq' ? 'bili' : 'qq'
  toast(`已切换为 ${next === 'qq' ? 'QQ音乐' : 'B站'} 音源`, 'info')
  await useSource(song, next)
}

/**
 * 用 B 站音源播放：没有匹配就先**自动匹配**。
 * 匹配不到时按用户偏好**不自动回退 QQ**，而是提示并等用户手动选择。
 */
async function playFromBili(song, index, seq, { isFallback = false } = {}) {
  // 已有匹配时不该显示「正在匹配」——那只是取音频，避免让人以为每次播放都要重匹配
  const hasMatch = state.matches[songKey(song)]?.status === 'ok'
  state.player.loadingText = hasMatch ? '正在获取 B 站音频…' : '正在匹配 B 站音源…'
  const match = await ensureMatch(song)
  if (seq !== playSeq || state.player.index !== index) return

  if (!match || match.status !== 'ok' || !match.bvid) {
    state.player.loading = false
    state.player.loadingText = ''
    state.player.playing = false
    const why = match?.error ? `（${match.error}）` : ''
    state.player.fallbackReason = `未匹配到 B 站音源${why}｜可点「搜索并选择」手动匹配，或在播放器上切换为 QQ 音乐音源`
    toast(`《${song.name}》未匹配到 B 站音源${why}`, 'error')
    return
  }

  state.player.loadingText = '正在获取 B 站音频…'
  try {
    const url = await fetchBiliAudio(match.bvid, state.config.biliCookie)
    if (seq !== playSeq) return
    playAudioSource(url, 'bili', song, seq)
    if (isFallback) state.player.fallbackReason = 'QQ 音乐音源不可用，已改用 B 站音源'
    return
  } catch (e) {
    if (seq !== playSeq) return
    pushError('B站音频流', e.message)
  }

  // B 站音频流拿不到（如仅 PCDN）→ 内嵌 iframe 兜底（出声但不可拖动）
  state.player.fallbackReason = 'B 站音频流不可用，已改用内嵌播放（不可拖动进度）'
  await playViaBiliIframe(song, index, seq)
}

/** 真正开始播放一首歌（歌单行入口与队列入口共用） */
async function startPlayback(song, rowIndex, seq) {
  state.player.index = rowIndex
  state.player.playing = true
  state.player.loading = true
  state.player.loadingText = ''
  state.player.source = 'none'
  state.player.currentTime = 0
  state.player.duration = song.interval || 0
  state.player.fallbackReason = ''
  stopTicker()
  if (audioEl) audioEl.pause()

  // 本地音乐（导入）与已下载歌曲：直接播本地文件（离线可用，P6）
  if (song.localUri) {
    playAudioSource(song.localUri, 'local', song, seq)
    return
  }
  const dl = state.downloads[songKey(song)]
  if (dl?.status === 'done' && dl.uri) {
    playAudioSource(dl.uri, 'local', song, seq)
    return
  }

  // 用户显式选过 QQ 音乐音源时，才优先走 QQ 直链
  if (sourceFor(song) === 'qq') {
    try {
      const info = await fetchSongUrlInfo(song.mid, state.config.uin, state.config.qqCookie)
      if (seq !== playSeq) return
      if (info.url) {
        playAudioSource(info.url, 'qq', song, seq)
        return
      }
      // 受限原因（G2）：付费/VIP 与无直链分开提示
      state.player.fallbackReason =
        info.restriction === 'vip_required'
          ? 'QQ 需要会员，已回退 B 站音源'
          : song.payplay
            ? 'VIP 歌曲无 QQ 直链，已回退 B 站音源'
            : 'QQ 无可用直链，已回退 B 站音源'
    } catch {
      state.player.fallbackReason = 'QQ 直链获取失败，已回退 B 站音源'
    }
    if (seq !== playSeq) return
    await playFromBili(song, rowIndex, seq, { isFallback: true })
    return
  }

  // 默认：B 站音源（未匹配则自动匹配）
  await playFromBili(song, rowIndex, seq)
}

/**
 * 解析某首歌的**可下载音频直链**（P6）：优先用户音源偏好，失败回退另一侧。
 * 与播放的区别：不走 iframe（无法下载），只返回 <audio> 可用的 URL。
 * @returns {Promise<{ url: string, source: 'qq'|'bili' }>}
 */
export async function resolveDownloadUrl(song) {
  if (!song) throw new Error('缺少歌曲')
  const tryQq = async () => {
    if (!song.mid) throw new Error('缺少歌曲 mid')
    const info = await fetchSongUrlInfo(song.mid, state.config.uin, state.config.qqCookie)
    if (!info.url) {
      throw new Error(info.restriction === 'vip_required' ? 'QQ 需要会员' : song.payplay ? 'VIP 歌曲无 QQ 直链' : 'QQ 无可用直链')
    }
    return { url: info.url, source: 'qq' }
  }
  const tryBili = async () => {
    const match = await ensureMatch(song)
    if (!match?.bvid) throw new Error('B站未匹配到视频')
    const url = await fetchBiliAudio(match.bvid, state.config.biliCookie)
    if (!url) throw new Error('B站音频获取失败')
    return { url, source: 'bili' }
  }
  const order = sourceFor(song) === 'qq' ? [tryQq, tryBili] : [tryBili, tryQq]
  let lastErr = null
  for (const fn of order) {
    try {
      return await fn()
    } catch (e) {
      lastErr = e
    }
  }
  throw lastErr || new Error('没有可用的音源')
}

/** 播放当前歌单的第 index 行（行内点击）；队列里没有这首歌时用歌单重建队列 */
export async function playIndex(index) {  if (index < 0 || index >= state.songs.length) return
  const song = state.songs[index]
  const key = songKey(song)
  let qi = state.queue.findIndex((e) => e.key === key)
  if (qi < 0) {
    state.queue = state.songs.map((s) => ({ key: songKey(s), song: s, from: 'list' }))
    qi = index
  }
  state.player.queueIndex = qi
  const seq = ++playSeq
  await startPlayback(song, index, seq)
  persistQueue()
}

export function togglePlay() {
  if (state.player.playing) {
    pause()
  } else if (state.queue.length) {
    if (state.player.queueIndex < 0) state.player.queueIndex = 0
    resume()
  } else if (state.songs.length) {
    playIndex(0)
  }
}

function resume() {
  const queueIndex = state.player.queueIndex
  const seq = ++playSeq
  state.player.playing = true
  const total = currentDuration.value
  const atEnd = Boolean(total) && state.player.currentTime >= total - 0.5
  if (isAudioSource() && audioEl && !atEnd) {
    // 可能是音源地址已过期（B站地址带 deadline）或被浏览器拦截：重新取一次地址再播
    audioEl.play().catch(() => playQueueAt(queueIndex))
    markTickBase()
    startSmoothTicker()
  } else if (state.player.source === 'iframe') {
    // iframe 无法「继续」：带 t= 从当前位置重载（否则会从头播）
    playViaBiliIframe(currentSong.value, state.player.index, seq, { startAt: state.player.currentTime || 0, record: false })
  } else {
    playQueueAt(queueIndex)
  }
}

export function pause() {
  playSeq++ // 作废在途的播放流程，避免「暂停后又被自动播放」
  state.player.playing = false
  state.player.loading = false
  state.player.loadingText = ''
  stopSmoothTicker()
  if (isAudioSource() && audioEl) audioEl.pause()
  else if (state.player.source === 'iframe') stopTicker()
  flushStats()
}

/** 拖动进度（QQ 直链 与 B 站音频流都支持；iframe 兜底会带 t= 重载） */
export function seek(seconds) {
  const total = currentDuration.value
  if (!total) return
  const t = Math.max(0, Math.min(seconds, total))
  state.player.currentTime = t
  state.player.smoothTime = t
  // 通知原生媒体控制立即推送（系统面板/通知栏进度依赖 PlaybackState，5s 节流会让它回弹）
  state.player.seekSeq++
  if (state.player.source === 'iframe') {
    // 内嵌播放无法精确 seek：重载 iframe 到目标时间
    clearSeekSettle()
    reloadIframeAt(t)
    return
  }
  if (isAudioSource() && audioEl && isFinite(audioEl.duration)) {
    seekTarget = t
    seekAt = performance.now()
    seekRetried = false
    try {
      audioEl.currentTime = t
      // 基准直接设为目标：缓冲期绝不从 audioEl 回读（会拿到旧位置 → 进度弹回原位）
      tickBase = t
      tickAt = performance.now()
    } catch {
      clearSeekSettle()
    }
  }
}

export function seekRatio(ratio) {
  seek(ratio * currentDuration.value)
}

export const PLAY_MODES = ['order', 'repeat', 'shuffle']
export function cycleMode() {
  const i = PLAY_MODES.indexOf(state.player.mode)
  state.player.mode = PLAY_MODES[(i + 1) % PLAY_MODES.length]
  const label = { order: '顺序播放', repeat: '单曲循环', shuffle: '随机播放' }[state.player.mode]
  toast(`播放模式：${label}`, 'info')
  saveConfig({ playMode: state.player.mode })
}

/** auto=true 表示是「一首播完自动切」，会遵循单曲循环 */
export function next(auto = false) {
  const q = state.queue
  if (!q.length) return
  const qi = state.player.queueIndex
  const mode = state.player.mode
  if (auto && mode === 'repeat') {
    playQueueAt(qi >= 0 ? qi : 0)
    return
  }
  if (mode === 'shuffle') {
    if (q.length === 1) return playQueueAt(0)
    let r = qi
    while (r === qi) r = Math.floor(Math.random() * q.length)
    playQueueAt(r)
    return
  }
  playQueueAt((qi + 1) % q.length)
}

export function prev() {
  const q = state.queue
  if (!q.length) return
  const qi = state.player.queueIndex
  if (state.player.mode === 'shuffle') {
    next()
    return
  }
  playQueueAt(qi <= 0 ? q.length - 1 : qi - 1)
}

export function clearMatches() {
  state.matches = {}
  persistMatches()
  toast('已清空匹配缓存', 'success')
}

export { currentSong, currentMatch, currentVideo, currentDuration, elapsed, progress, matchedCount }
