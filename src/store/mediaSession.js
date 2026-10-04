/**
 * 媒体控制（A11）—— Web 端 Media Session API + App 端原生注入（P1.4b）。
 *
 * Web：系统媒体面板 / 锁屏 / 耳机按键 的元数据与控制（本文件下半部分）。
 * App：由 `src/core/mediaControl.js` 注入的原生后端接管（MediaSession + 前台服务 + 通知栏），
 *      音频仍在 WebView 里播放，原生只负责会话与通知；动作通过事件回传到这里执行。
 *
 * 特性检测：不支持的环境（含 Node 测试、部分 WebView）直接跳过，不影响主流程。
 */
import { watch } from 'vue'
import { state, songKey } from './state.js'
import { currentSong, currentDuration, togglePlay, next, prev, seek } from './player.js'
import { currentLyricLine } from './desktopLyric.js'
import { resolveImageUrl } from '../core/http.js'
import { hasMediaControl, mediaControlUpdate, mediaControlClear, mediaControlOnAction } from '../core/mediaControl.js'

let inited = false
let ms = null
let lastPositionAt = 0

function setHandler(action, fn) {
  try {
    ms.setActionHandler(action, fn)
  } catch {
    /* 个别动作在部分浏览器不支持，忽略 */
  }
}

function updateMetadata() {
  const song = currentSong.value
  if (!song) {
    try {
      ms.metadata = null
    } catch {
      /* ignore */
    }
    return
  }
  const match = state.matches[songKey(song)]
  const cover = song.cover || (match?.status === 'ok' ? match.cover : '')
  const artwork = []
  if (cover) {
    // Web 端 resolveImageUrl 返回同源代理地址（字符串）；原生端是 Promise（跳过封面）
    let src = ''
    try {
      const resolved = resolveImageUrl(cover)
      if (typeof resolved === 'string') src = resolved
    } catch {
      /* ignore */
    }
    if (src) artwork.push({ src, sizes: '300x300', type: 'image/jpeg' })
  }
  try {
    if (typeof MediaMetadata !== 'function') return
    ms.metadata = new MediaMetadata({
      title: song.name || '',
      artist: (song.singers || []).join(' / ') || '未知歌手',
      album: song.album || '',
      artwork,
    })
  } catch {
    /* ignore */
  }
}

function updatePosition() {
  if (typeof ms.setPositionState !== 'function') return
  const duration = state.player.duration || currentSong.value?.interval || 0
  if (!duration || !isFinite(duration) || duration <= 0) return
  const position = Math.min(Math.max(state.player.currentTime || 0, 0), duration)
  try {
    ms.setPositionState({ duration, position, playbackRate: 1 })
  } catch {
    /* ignore */
  }
}

export function initMediaSession() {
  if (inited) return
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return
  inited = true
  ms = navigator.mediaSession

  setHandler('play', () => {
    if (!state.player.playing) togglePlay()
  })
  setHandler('pause', () => {
    if (state.player.playing) togglePlay()
  })
  setHandler('previoustrack', () => prev())
  setHandler('nexttrack', () => next())
  setHandler('stop', () => {
    if (state.player.playing) togglePlay()
  })
  setHandler('seekto', (d) => {
    if (d && typeof d.seekTime === 'number') seek(d.seekTime)
  })
  setHandler('seekbackward', (d) => seek((state.player.currentTime || 0) - (d?.seekOffset || 10)))
  setHandler('seekforward', (d) => seek((state.player.currentTime || 0) + (d?.seekOffset || 10)))

  watch(
    () => songKey(currentSong.value || {}),
    () => {
      updateMetadata()
      updatePosition()
    }
  )
  watch(
    () => state.player.playing,
    (playing) => {
      try {
        ms.playbackState = playing ? 'playing' : 'paused'
      } catch {
        /* ignore */
      }
    }
  )
  watch(
    () => state.player.currentTime,
    () => {
      const now = Date.now()
      if (now - lastPositionAt < 3000) return
      lastPositionAt = now
      updatePosition()
    }
  )

  updateMetadata()
  updatePosition()
}

// ---------------------------------------------------------------------------
// App 端：原生媒体控制（通知栏 / 锁屏 / 蓝牙按键）
// ---------------------------------------------------------------------------
function initNativeMediaControl() {
  mediaControlOnAction(({ action, seekTime }) => {
    if (action === 'play') {
      if (!state.player.playing) togglePlay()
    } else if (action === 'pause') {
      if (state.player.playing) togglePlay()
    } else if (action === 'next') {
      next()
    } else if (action === 'prev') {
      prev()
    } else if (action === 'seek') {
      seek(Number(seekTime) || 0)
    }
  })

  let lastPushAt = 0
  let seekPushTimer = null
  /**
   * 是否推送过「有歌」状态。
   * 注意：**启动时无歌不要发 clear**（stopService 会与恢复播放触发的
   * startForegroundService 竞态，系统判定前台服务未完成 → 进程被杀）。
   * 只有「原本在播 → 变没歌」才清理通知。
   */
  let hadSong = false
  const push = () => {
    const song = currentSong.value
    if (!song) {
      if (hadSong) {
        hadSong = false
        mediaControlClear()
      }
      return
    }
    hadSong = true
    const match = state.matches[songKey(song)]
    const cover = song.cover || (match?.status === 'ok' ? match.cover : '')
    mediaControlUpdate({
      title: song.name || '',
      artist: (song.singers || []).join(' / ') || '未知歌手',
      album: song.album || '',
      artwork: cover,
      playing: state.player.playing,
      position: state.player.currentTime || 0,
      duration: currentDuration.value || 0,
      // 通知栏折叠态显示当前歌词行（无歌词时原生回退显示歌手）
      lyric: currentLyricLine.value?.text || '',
    })
  }

  watch(
    () => songKey(currentSong.value || {}),
    () => push()
  )
  // 歌词行变化时刷新通知（行级频率，通常几秒一次）
  watch(currentLyricLine, () => push())
  watch(
    () => state.player.playing,
    () => push()
  )
  watch(
    () => state.player.currentTime,
    () => {
      const now = Date.now()
      if (now - lastPushAt < 5000) return
      lastPushAt = now
      push()
    }
  )
  // seek 后立即（+250ms 尾随）推送位置：否则系统媒体面板按旧状态把进度条拉回（真机回弹）
  watch(
    () => state.player.seekSeq,
    () => {
      lastPushAt = Date.now()
      push()
      if (seekPushTimer) clearTimeout(seekPushTimer)
      seekPushTimer = setTimeout(() => {
        seekPushTimer = null
        lastPushAt = Date.now()
        push()
      }, 250)
    }
  )

  push()
}

/** 初始化：App 用原生后端，Web 用浏览器 Media Session */
export function initMediaControl() {
  if (hasMediaControl()) {
    initNativeMediaControl()
    return
  }
  initMediaSession()
}

initMediaControl()
