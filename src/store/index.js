/**
 * 状态层聚合入口。
 * 实现已按域拆分到同目录各文件（state / ui / errors / access / player / library / user / diagnostics），
 * 此文件保留既有导入路径（组件 / 测试等）。
 */
export * from './state.js'
export * from './ui.js'
export * from './errors.js'
export * from './access.js'
export * from './player.js'
export * from './library.js'
export * from './user.js'
export * from './diagnostics.js'
export * from './lyric.js'
export * from './desktopLyric.js'
export * from './search.js'
export * from './fav.js'
export * from './favWrite.js'
export * from './write.js'
export * from './playlistWrite.js'
export * from './songComments.js'
export * from './downloads.js'
export * from './stats.js'
export * from './transfer.js'
export * from './accounts.js'
export * from './theme.js'
export * from './miniPlayer.js'
// 副作用导入：注册 Web Media Session（系统媒体面板控制），不支持的环境自动跳过
import './mediaSession.js'

import { state } from './state.js'
import {
  currentSong,
  currentMatch,
  currentVideo,
  currentDuration,
  elapsed,
  progress,
  matchedCount,
} from './player.js'
import { createdPlaylists, collectedPlaylists } from './library.js'
import { isLoggedIn } from './user.js'
import { failedChecks } from './diagnostics.js'

export const store = {
  state,
  currentSong,
  currentMatch,
  currentVideo,
  currentDuration,
  elapsed,
  progress,
  matchedCount,
  isLoggedIn,
  createdPlaylists,
  collectedPlaylists,
  failedChecks,
}
