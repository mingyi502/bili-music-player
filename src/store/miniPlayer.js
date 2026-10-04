/**
 * 迷你播放器（P8.2 H2，仅 App）。
 *
 * 原生悬浮小窗（歌名 / 歌手 + 上一首 / 播放暂停 / 下一首 / 关闭），
 * 与桌面歌词互斥；开关持久化 `bmp:mini-player`，动作通过 action 事件回到 JS。
 */
import { watch } from 'vue'
import { state, LS } from './state.js'
import { toast } from './ui.js'
import { currentSong, prev, next, togglePlay } from './player.js'
import { currentLyricLine } from './desktopLyric.js'
import {
  hasMiniPlayer,
  mediaControlSetMiniPlayer,
  mediaControlUpdateMiniPlayer,
  mediaControlSetOverlay,
  mediaControlHasOverlayPermission,
  mediaControlRequestOverlayPermission,
  mediaControlOnAction,
} from '../core/mediaControl.js'

/** 供 UI 判断入口是否可见（仅 App） */
export { hasMiniPlayer }

function persist() {
  try {
    localStorage.setItem(LS.miniPlayer, JSON.stringify(!!state.miniPlayer.enabled))
  } catch {
    /* 配额异常不打断业务 */
  }
}

/** 把当前歌曲与播放态推给悬浮小窗（含当前歌词行） */
function pushMini() {
  if (!state.miniPlayer.enabled) return
  const song = currentSong.value
  mediaControlUpdateMiniPlayer({
    title: song?.name || '',
    artist: (song?.singers || []).join(' / '),
    playing: !!state.player.playing,
    lyric: currentLyricLine.value?.text || '',
  })
}

/** 悬浮小窗按钮 / 关闭动作（原生 → JS） */
mediaControlOnAction(({ action }) => {
  if (action === 'miniPrev') prev()
  else if (action === 'miniNext') next()
  else if (action === 'miniToggle') togglePlay()
  else if (action === 'miniClosed') {
    if (state.miniPlayer.enabled) {
      state.miniPlayer.enabled = false
      persist()
    }
    toast('已关闭迷你播放器', 'info')
  }
})

/** 开关迷你播放器（仅 App；未授权时引导去系统设置） */
export async function toggleMiniPlayer() {
  if (!hasMiniPlayer()) {
    toast('迷你播放器仅 App 可用', 'info')
    return false
  }
  if (state.miniPlayer.enabled) {
    state.miniPlayer.enabled = false
    persist()
    await mediaControlSetMiniPlayer(false)
    toast('已关闭迷你播放器', 'info')
    return false
  }
  const granted = await mediaControlHasOverlayPermission()
  state.miniPlayer.permission = granted
  if (!granted) {
    await mediaControlRequestOverlayPermission()
    toast('请允许「显示在其他应用上层」，返回后再点一次开启', 'info')
    return false
  }
  // 与桌面歌词互斥（原生侧也会互斥，这里同步 JS 状态）
  if (state.desktopLyric.enabled) {
    state.desktopLyric.enabled = false
    try {
      localStorage.setItem(LS.desktopLyric, 'false')
    } catch {
      /* ignore */
    }
    mediaControlSetOverlay(false)
  }
  state.miniPlayer.enabled = true
  persist()
  await mediaControlSetMiniPlayer(true)
  pushMini()
  toast('已开启迷你播放器（退出 App 后显示，可拖动）', 'success')
  return true
}

// 歌曲 / 播放态 / 歌词行变化时同步小窗
watch(currentSong, pushMini)
watch(
  () => state.player.playing,
  pushMini
)
watch(currentLyricLine, pushMini)

// 启动时恢复（原生悬浮窗需要重新挂载）
if (hasMiniPlayer()) {
  if (state.miniPlayer.enabled) {
    mediaControlSetMiniPlayer(true)
    pushMini()
  }
}
