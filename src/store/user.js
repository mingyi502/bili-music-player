/**
 * 账号：登录（扫码/网页/手动 Cookie）、登出、启动恢复。
 */
import { computed } from 'vue'
import { state, saveConfig, persistConfig, persistMatches, persistUser } from './state.js'
import { toast } from './ui.js'
import { recordError } from './errors.js'
import { closeQrSession, clearWebLoginCookies } from '../api/auth.js'
import { fetchUserInfo, fetchUserPlaylists, defaultAvatar, parseUinFromCookie } from '../api/qq.js'
import { importUserPlaylists } from './library.js'
import { runDiagnostics } from './diagnostics.js'
import { haltPlayback, releaseAudio, pause, resetQueue } from './player.js'

/** 扫码成功后写入会话并自动导入歌单 */
export async function loginWithSession(session) {
  const { cookie, uin, nickname, avatar, vip, partial } = session
  state.loginMethod = session.method || 'qr'
  if (session.webInfo) state.webLoginInfo = session.webInfo
  // 切换账号/重新登录：先清掉上一个账号的残留，避免串数据
  haltPlayback()
  state.songs = []
  state.playlist = null
  state.player.index = -1
  state.player.playing = false
  state.player.loading = false
  state.player.loadingText = ''
  state.player.source = 'none'
  state.player.currentTime = 0
  state.playlists = []
  state.albums = []
  state.albumTotal = 0
  state.likedSongs = []
  state.likedCount = 0
  state.likedTotal = 0
  state.musicLoaded = false
  state.fav.map = {}
  state.fav.pending = {}
  state.fav.liked = {}
  state.matches = {}
  persistMatches()
  resetQueue()

  saveConfig({ qqCookie: cookie || '', uin: uin || '', euin: '', loginMethod: state.loginMethod })
  state.user = {
    uin: uin || '',
    nickname: nickname || `QQ ${uin || ''}`.trim(),
    avatar: avatar || defaultAvatar(uin),
    vip: vip || 0,
  }
  persistUser()
  state.loginOpen = false
  toast(partial ? '已登录（会话受限），正在校验可用功能…' : `已登录：${state.user.nickname}`, partial ? 'info' : 'success')
  await importUserPlaylists()
  // 登录后自动体检；若有失败项，直接弹出诊断面板，无需手动排查
  const failed = await runDiagnostics()
  if (failed.length) state.diagnostics.open = true
}

/** 手动粘贴 Cookie 登录：从 Cookie 解析 uin，建立登录态并导入歌单 */
export async function loginWithCookie(cookie) {
  const text = String(cookie || '').trim()
  state.loginMethod = 'cookie'
  const uin = parseUinFromCookie(text)
  saveConfig({ qqCookie: text, uin, euin: '', loginMethod: state.loginMethod })
  state.user = {
    uin,
    nickname: state.user?.nickname || (uin ? `QQ ${uin}` : 'QQ音乐用户'),
    avatar: state.user?.avatar || defaultAvatar(uin),
    vip: state.user?.vip || 0,
  }
  persistUser()
  state.musicLoaded = false
  toast(uin ? `已使用 Cookie 登录（QQ ${uin}）` : '已保存 Cookie（未能解析出 QQ 号）', uin ? 'success' : 'info')
  await importUserPlaylists()
  const failed = await runDiagnostics()
  if (failed.length) state.diagnostics.open = true
}

export async function logout() {
  pause()
  releaseAudio()
  state.user = null
  persistUser()
  state.config.qqCookie = ''
  state.config.uin = ''
  state.config.euin = ''
  state.config.loginMethod = ''
  state.loginMethod = ''
  persistConfig()
  closeQrSession()
  // 同时清掉「网页登录」遗留的浏览器 Cookie，避免下次登录直接是上一个账号
  clearWebLoginCookies().catch(() => {})
  state.playlists = []
  state.likedSongs = []
  state.likedCount = 0
  state.likedTotal = 0
  state.albums = []
  state.albumTotal = 0
  state.musicLoaded = false
  state.songs = []
  state.playlist = null
  state.player.index = -1
  state.player.playing = false
  state.player.loading = false
  state.player.loadingText = ''
  state.player.source = 'none'
  state.player.currentTime = 0
  state.player.duration = 0
  state.fav.map = {}
  state.fav.pending = {}
  state.fav.liked = {}
  state.matches = {}
  persistMatches()
  resetQueue()
  state.diagnostics.checks = []
  state.diagnostics.errors = []
  toast('已退出登录', 'success')
}

/** 启动时若存在登录态，则刷新资料并重新导入歌单 */
export async function restoreSession() {
  if (!state.config.qqCookie || !state.config.uin) return
  let valid = false
  try {
    const info = await fetchUserInfo(state.config.uin, state.config.qqCookie)
    state.user = {
      uin: info.uin || state.config.uin,
      nickname: info.nickname || state.user?.nickname || '',
      avatar: info.avatar || state.user?.avatar || defaultAvatar(state.config.uin),
      vip: info.vip || 0,
    }
    persistUser()
    valid = true
  } catch (e) {
    // 资料接口失败（如 code=1000）不等于登录失效，用歌单接口复核
    try {
      const list = await fetchUserPlaylists(state.config.uin, state.config.qqCookie)
      state.playlists = list
      valid = true
      if (state.user && !state.user.avatar) {
        state.user.avatar = defaultAvatar(state.config.uin)
        persistUser()
      }
    } catch {
      recordError('会话校验', '登录态已失效，请重新登录')
      state.user = null
      persistUser()
    }
  }
  // 关键：无论走哪个分支，只要会话有效就导入「我喜欢 / 专辑 / 歌单」
  if (valid) await importUserPlaylists()
}

export const isLoggedIn = computed(() => Boolean(state.user && state.config.qqCookie))
