/**
 * 桌面歌词（P2.3，仅 App）。
 *
 * 把当前歌词行（行级 + 逐字 QRC + 罗马音 + 翻译）推给原生悬浮窗；
 * 开关持久化 `bmp:desktop-lyric`。
 * 悬浮窗权限（SYSTEM_ALERT_WINDOW）无法弹窗申请，只能引导用户去系统设置授权。
 */
import { computed, watch } from 'vue'
import { state, LS } from './state.js'
import { toast } from './ui.js'
import { currentSong, elapsed } from './player.js'
import { lyricOffsetFor } from './lyric.js'
import { findLineIndex, toLyricTime } from '../utils/lrc.js'
import { wordState } from '../utils/qrc.js'
import {
  hasMediaControl,
  mediaControlSetOverlay,
  mediaControlUpdateLyric,
  mediaControlHasOverlayPermission,
  mediaControlRequestOverlayPermission,
  mediaControlOnAction,
} from '../core/mediaControl.js'

// 悬浮窗卡片「关闭」按钮 / 通知栏「桌面歌词」开关的动作同步回 JS 状态
mediaControlOnAction(({ action, value }) => {
  if (action === 'overlayClosed') {
    if (state.desktopLyric.enabled) {
      state.desktopLyric.enabled = false
      persist()
    }
    toast('已关闭桌面歌词', 'info')
  } else if (action === 'overlayToggled') {
    const enabled = Number(value) === 1
    state.desktopLyric.enabled = enabled
    persist()
    toast(enabled ? '已开启桌面歌词（退出 App 后显示）' : '已关闭桌面歌词', 'info')
  } else if (action === 'overlayDenied') {
    toast('需要「显示在其他应用上层」权限，请在设置中开启', 'info')
  }
})

/** 当前应显示的歌词行（含校准偏移） */
export const currentLyricLine = computed(() => {
  const lines = state.lyric.lines
  if (!lines.length) return null
  const song = currentSong.value
  const offset = song ? lyricOffsetFor(song) : 0
  const i = findLineIndex(lines, toLyricTime(elapsed.value, offset))
  return i >= 0 ? lines[i] : null
})

function persist() {
  try {
    localStorage.setItem(LS.desktopLyric, JSON.stringify(!!state.desktopLyric.enabled))
  } catch {
    /* 配额异常不打断业务 */
  }
}

/**
 * 推送帧：行文本 + 翻译 + 罗马音 + 逐字状态（P8.4b）。
 * 词进度分 8 桶，只有桶变化才推送，避免前台 rAF（~30Hz）把原生刷爆；
 * 后台时由 timeupdate（~4Hz）驱动，仍能逐词推进。
 */
const lyricFrame = computed(() => {
  const line = currentLyricLine.value
  if (!line) return { line: '', trans: '', roma: '', words: null, sung: -1, progress: 0 }
  const song = currentSong.value
  const offset = song ? lyricOffsetFor(song) : 0
  const useQrc = !!state.config.lyricQrc && Array.isArray(line.words) && line.words.length > 1
  const ws = useQrc ? wordState(line.words, toLyricTime(elapsed.value, offset)) : null
  return {
    line: line.text || '',
    trans: line.trans || '',
    roma: state.config.lyricRoma ? line.roma || '' : '',
    words: useQrc ? line.words.map((w) => w.text) : null,
    sung: ws ? ws.index : -1,
    progress: ws ? Math.round(Math.min(Math.max(ws.progress, 0), 1) * 8) / 8 : 0,
  }
})

function frameKey(f) {
  if (!f) return ''
  return [f.line, f.trans, f.roma, f.sung, f.progress, (f.words || []).join('\u0001')].join('\u0002')
}

let lastKey = ''
function pushLyric() {
  if (!state.desktopLyric.enabled) return
  const f = lyricFrame.value
  const key = frameKey(f)
  if (key === lastKey) return
  lastKey = key
  mediaControlUpdateLyric(f)
}

/** 刷新悬浮窗权限状态（从系统设置返回后可再调用） */
export async function refreshDesktopLyricPermission() {
  if (!hasMediaControl()) return false
  state.desktopLyric.permission = await mediaControlHasOverlayPermission()
  return state.desktopLyric.permission
}

/** 开关桌面歌词（仅 App；未授权时引导去系统设置） */
export async function toggleDesktopLyric() {
  if (!hasMediaControl()) {
    toast('桌面歌词仅 App 可用', 'info')
    return
  }
  if (state.desktopLyric.enabled) {
    state.desktopLyric.enabled = false
    persist()
    await mediaControlSetOverlay(false)
    toast('已关闭桌面歌词', 'info')
    return
  }
  const granted = await mediaControlHasOverlayPermission()
  state.desktopLyric.permission = granted
  if (!granted) {
    await mediaControlRequestOverlayPermission()
    toast('请允许「显示在其他应用上层」，返回后再点一次开启', 'info')
    return
  }
  state.desktopLyric.enabled = true
  persist()
  await mediaControlSetOverlay(true)
  lastKey = ''
  pushLyric()
  toast('已开启桌面歌词（退出 App 后显示，可拖动）', 'success')
}

// 歌词帧（行 / 逐字进度 / 罗马音）或开关变化时同步到悬浮窗
watch(lyricFrame, pushLyric)
watch(
  () => state.desktopLyric.enabled,
  () => {
    lastKey = ''
    pushLyric()
  }
)

// 启动时恢复：App 重启后原生悬浮窗需要重新挂载；顺便刷新权限状态
if (hasMediaControl()) {
  refreshDesktopLyricPermission()
  if (state.desktopLyric.enabled) {
    mediaControlSetOverlay(true)
    pushLyric()
  }
}
