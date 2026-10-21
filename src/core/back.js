/**
 * Android 物理返回键。
 *
 * Capacitor 默认没有 backButton 监听时，返回键会直接 finish 当前 Activity
 * （表现为「回到桌面」）。这里的优先级：
 *   1. 先关闭最上层弹窗 / 全屏播放器 / 队列 / 侧栏；
 *   2. 有上一页历史 → router.back()；
 *   3. 深链进入且没有历史 → 回首页；
 *   4. 已在首页 → 最小化 App（保留在最近任务，不直接杀进程）。
 */
import { state } from '../store/state.js'
import { resolveConfirm } from '../store/ui.js'
import { closeCandidateDialog } from '../store/player.js'
import { closePlaylistPicker } from '../store/playlistWrite.js'
import { initBackButton } from '../platform/index.js'
import { isFirstLevelPath, isSecondLevelPath } from '../utils/navLevels.js'

/** 纯函数：根据当前 UI 状态决定返回键行为（便于测试） */
export function decideBackAction({ overlay = '', canGoBack = false, path = '/' } = {}) {
  if (overlay) return { type: 'close-overlay', overlay }
  // 侧栏入口是一级页面：返回键只最小化，不回到上一个一级页面。
  if (isFirstLevelPath(path)) return { type: 'minimize' }
  // 歌手/专辑/歌曲详情是二级页面：有历史就返回，没有就回首页。
  if (isSecondLevelPath(path)) {
    return canGoBack ? { type: 'router-back' } : { type: 'home' }
  }
  if (canGoBack) return { type: 'router-back' }
  if (path && path !== '/') return { type: 'home' }
  return { type: 'minimize' }
}

/** 当前最上层、可被返回键关闭的界面 */
export function topOverlay() {
  if (state.confirm.open) return 'confirm'
  if (state.loginOpen) return 'login'
  if (state.ui.settingsOpen) return 'settings'
  if (state.ui.share.open) return 'share'
  if (state.actionSheet.open) return 'actionSheet'
  if (state.playlistPicker.open) return 'playlistPicker'
  if (state.candidateDialog.open) return 'candidate'
  if (state.diagnostics.open) return 'diagnostics'
  // 队列在播放器之上；侧栏又在主界面之上
  if (state.ui.queueOpen) return 'queue'
  if (state.ui.sidebarOpen) return 'sidebar'
  if (state.ui.playerExpanded) return 'player'
  return ''
}

function closeOverlay(name) {
  switch (name) {
    case 'confirm':
      resolveConfirm(false)
      break
    case 'login':
      state.loginOpen = false
      break
    case 'settings':
      state.ui.settingsOpen = false
      break
    case 'share':
      state.ui.share.open = false
      break
    case 'actionSheet':
      state.actionSheet.open = false
      state.actionSheet.items = []
      break
    case 'playlistPicker':
      closePlaylistPicker()
      break
    case 'candidate':
      closeCandidateDialog()
      break
    case 'diagnostics':
      state.diagnostics.open = false
      break
    case 'queue':
      state.ui.queueOpen = false
      break
    case 'sidebar':
      state.ui.sidebarOpen = false
      break
    case 'player':
      state.ui.playerExpanded = false
      break
    default:
      break
  }
}

/**
 * 执行一次返回。返回实际执行的动作，方便日志 / 测试断言。
 * @param {{router?: object, app?: {minimizeApp?: Function}}} ctx
 */
export async function handleBack({ router, app } = {}) {
  const path = router?.currentRoute?.value?.path || '/'
  const canGoBack =
    typeof window !== 'undefined' && Boolean(window.history?.state?.back)
  const action = decideBackAction({ overlay: topOverlay(), canGoBack, path })

  if (action.type === 'close-overlay') {
    closeOverlay(action.overlay)
    return action
  }
  if (action.type === 'router-back') {
    router?.back?.()
    return action
  }
  if (action.type === 'home') {
    await router?.replace?.('/')
    return action
  }
  // 首页再按返回：最小化到桌面，但保留最近任务，不直接退出
  await app?.minimizeApp?.()
  return action
}

let backListener = null

/** 仅在原生容器内注册（Web 端交给浏览器自身的历史记录） */
export async function initBackNavigation(router) {
  if (backListener) return backListener
  backListener = await initBackButton((app) => {
    void handleBack({ router, app })
  })
  return backListener
}
