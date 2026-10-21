/**
 * 音乐库：歌单导入、「我喜欢」、收藏专辑、歌单/专辑加载。
 */
import { computed } from 'vue'
import { state, LS, loadLS, persistConfig, persistUserData, setLikedMids } from './state.js'
import { toast } from './ui.js'
import { recordError, pushError } from './errors.js'
import { pause, setQueueFromSongs } from './player.js'
import {
  fetchUserPlaylists,
  fetchCollectedPlaylists,
  fetchEncryptUin,
  fetchLikedSongs,
  fetchUserAlbums,
  fetchAlbumSongs,
  fetchPlaylistSongs,
  isLikedDirId,
} from '../api/qq.js'
import { fetchPlaylistFavs } from '../api/qq/fav.js'

/**
 * 收藏歌单：优先 musicu `PlaylistFavRead`（与 `FavPlaylist` 写同一数据源），
 * 失败或缺 euin 时回退旧接口 `fcg_get_profile_order_asset`（D3 复验发现旧接口不反映写入）。
 */
async function fetchCollectedSmart(uin, cookie) {
  try {
    const euin = await ensureEuin()
    return await fetchPlaylistFavs(euin, { cookie, uin })
  } catch {
    return await fetchCollectedPlaylists(uin, cookie)
  }
}

/** 登录后自动导入「创建的歌单 + 收藏的歌单」，并记录每个来源的失败原因 */
export async function importUserPlaylists() {
  const uin = state.config.uin
  const cookie = state.config.qqCookie
  if (!uin || !cookie) {
    recordError('导入歌单', '缺少 QQ 号或登录 Cookie，请重新登录')
    return []
  }
  state.loading.playlists = true
  try {
    const [createdRes, collectedRes] = await Promise.allSettled([
      fetchUserPlaylists(uin, cookie),
      fetchCollectedSmart(uin, cookie),
    ])
    const created = createdRes.status === 'fulfilled' ? createdRes.value : []
    const collected = collectedRes.status === 'fulfilled' ? collectedRes.value : []
    state.playlists = [...created, ...collected]

    if (createdRes.status === 'rejected') {
      recordError('创建的歌单', createdRes.reason?.message || createdRes.reason)
    }
    if (collectedRes.status === 'rejected') {
      recordError('收藏的歌单', collectedRes.reason?.message || collectedRes.reason)
    }
    if (createdRes.status === 'fulfilled' || collectedRes.status === 'fulfilled') {
      toast(`已导入 ${created.length} 个创建歌单、${collected.length} 个收藏歌单`, 'success')
    }
    // 「我喜欢」「专辑」并行拉取（串行会让启动多等一倍），并写入本地缓存
    await Promise.allSettled([refreshLikedSongs({ silent: true }), refreshAlbums({ silent: true })])
    persistUserData()
    return state.playlists
  } finally {
    state.loading.playlists = false
    state.musicLoaded = true
  }
}

let euinPromise = null
export async function ensureEuin() {
  if (state.config.euin) return state.config.euin
  const uinAtCall = state.config.uin
  // 并发调用共享同一个请求，避免同时打两次、也避免失败被永久缓存
  if (!euinPromise) {
    euinPromise = fetchEncryptUin(uinAtCall, state.config.qqCookie)
      .then((v) => {
        // 期间可能已登出/换号，不要写回旧账号的 euin
        if (v && state.config.uin === uinAtCall) {
          state.config.euin = v
          persistConfig()
        }
        return v || ''
      })
      .catch(() => '')
      .finally(() => {
        euinPromise = null
      })
  }
  return euinPromise
}

/** 上次缓存的「我喜欢」数量，用于识别「本次返回 0」这种异常 */
function cachedLikedTotal(uin) {
  const d = loadLS(LS.userData, null)
  return d && d.uin === uin ? d.likedTotal || d.likedCount || 0 : 0
}

/** 拉取「我喜欢的音乐」并缓存，供侧栏置顶与播放。
 *  带 in-flight 去重：启动导入未完成时点击「我喜欢」不会重复发一遍请求。 */
let likedInflight = null
export function refreshLikedSongs(opts = {}) {
  if (likedInflight) return likedInflight
  likedInflight = doRefreshLikedSongs(opts).finally(() => {
    likedInflight = null
  })
  return likedInflight
}

async function doRefreshLikedSongs({ silent = false } = {}) {
  const uin = state.config.uin
  const cookie = state.config.qqCookie
  if (!uin || !cookie) {
    if (!silent) recordError('我喜欢的音乐', '请先登录')
    return []
  }
  try {
    const euin = await ensureEuin()
    const { songs, total, pages } = await fetchLikedSongs(uin, euin, cookie)
    // 异常保护：本次 0 首但缓存里有数据，视为失败，保留旧值不覆盖
    if (!songs.length && !total) {
      const prev = cachedLikedTotal(uin)
      if (prev > 0) {
        state.likedTotal = prev
        state.likedCount = prev
        pushError('我喜欢的音乐', `本次返回 0 首（此前 ${prev} 首），已保留缓存`)
        return []
      }
    }
    state.likedSongs = songs
    setLikedMids(songs)
    state.likedTotal = total || songs.length
    state.likedCount = total || songs.length
    persistUserData()
    if (!silent) {
      toast(
        `「我喜欢」共 ${state.likedTotal} 首${songs.length !== state.likedTotal ? `（已加载 ${songs.length}）` : ''}`,
        songs.length ? 'success' : 'error'
      )
    }
    if (!songs.length && total) pushError('我喜欢的音乐', `接口返回 total=${total} 但未解析到歌曲`)
    if (songs.length !== total && total) {
      pushError('我喜欢的音乐', `已加载 ${songs.length} / 共 ${total}（分页 ${pages} 次）`)
    }
    return songs
  } catch (e) {
    if (silent) pushError('我喜欢的音乐', e.message)
    else recordError('我喜欢的音乐', e.message)
    return []
  }
}

/** 拉取收藏的专辑并缓存（带 in-flight 去重） */
let albumsInflight = null
export function refreshAlbums(opts = {}) {
  if (albumsInflight) return albumsInflight
  albumsInflight = doRefreshAlbums(opts).finally(() => {
    albumsInflight = null
  })
  return albumsInflight
}

async function doRefreshAlbums({ silent = false } = {}) {
  const uin = state.config.uin
  const cookie = state.config.qqCookie
  if (!uin || !cookie) {
    if (!silent) recordError('收藏的专辑', '请先登录')
    return []
  }
  try {
    const euin = await ensureEuin()
    const { albums, total, pages } = await fetchUserAlbums(uin, euin, cookie)
    if (!albums.length && !total) {
      const d = loadLS(LS.userData, null)
      const prev = d && d.uin === uin ? d.albumTotal || (d.albums || []).length : 0
      if (prev > 0) {
        state.albumTotal = prev
        pushError('收藏的专辑', `本次返回 0 张（此前 ${prev} 张），已保留缓存`)
        return []
      }
    }
    state.albums = albums
    state.albumTotal = total || albums.length
    persistUserData()
    if (!silent) toast(`收藏的专辑共 ${state.albumTotal} 张${albums.length !== state.albumTotal ? `（已加载 ${albums.length}）` : ''}`, 'success')
    if (albums.length !== total && total) pushError('收藏的专辑', `已加载 ${albums.length} / 共 ${total}（分页 ${pages} 次）`)
    return albums
  } catch (e) {
    if (silent) pushError('收藏的专辑', e.message)
    else recordError('收藏的专辑', e.message)
    return []
  }
}

/** 打开一张专辑（加载其歌曲到主列表） */
export async function loadAlbum(album) {
  state.loading.playlist = true
  try {
    const { playlist, songs } = await fetchAlbumSongs(album.mid, state.config.qqCookie)
    playlist.cover = playlist.cover || album.cover
    state.playlist = playlist
    state.songs = songs
    setQueueFromSongs(songs)
    state.player.index = -1
    pause()
    toast(`专辑《${playlist.name}》共 ${songs.length} 首`, songs.length ? 'success' : 'error')
  } catch (e) {
    recordError('专辑详情', e.message)
  } finally {
    state.loading.playlist = false
  }
}

/** 在歌曲列表中打开「我喜欢」 */
export async function showLiked() {
  if (!state.likedSongs.length) await refreshLikedSongs({ silent: false })
  if (!state.likedSongs.length) return
  const coverHit = state.likedSongs.find((s) => s.cover)
  state.playlist = {
    id: 'liked',
    name: '我喜欢的音乐',
    cover: coverHit ? coverHit.cover.replace('150x150', '300x300') : '',
    songCount: state.likedTotal || state.likedSongs.length,
    nick: state.user?.nickname || '',
    liked: true,
  }
  state.songs = [...state.likedSongs]
  setLikedMids(state.likedSongs)
  setQueueFromSongs(state.songs)
  state.player.index = -1
  pause()
  const extra = state.likedSongs.length !== state.likedTotal ? `（已加载 ${state.likedSongs.length}）` : ''
  toast(`「我喜欢」共 ${state.likedTotal || state.likedSongs.length} 首${extra}`, 'success')
}

export async function loadPlaylist(input) {
  state.loading.playlist = true
  try {
    const { playlist, songs } = await fetchPlaylistSongs(input, state.config.qqCookie, state.config.uin)
    state.playlist = playlist
    state.songs = songs
    setQueueFromSongs(songs)
    state.player.index = -1
    pause()
    toast(`《${playlist.name}》共 ${songs.length} 首`, 'success')
    return playlist
  } catch (e) {
    toast(e.message || '加载歌单失败', 'error')
    throw e
  } finally {
    state.loading.playlist = false
  }
}

export const createdPlaylists = computed(() =>
  state.playlists.filter((p) => p.kind !== 'collected' && !isLikedDirId(p.id, p.dirId)),
)
export const collectedPlaylists = computed(() => state.playlists.filter((p) => p.kind === 'collected'))

/**
 * 写操作后的缓存失效（P4.0）：按类型刷新，避免各调用点手写刷新逻辑。
 * - liked：刷新「我喜欢」列表与计数
 * - playlists：重新导入创建 / 收藏的歌单
 * - albums：刷新收藏的专辑
 * - playlistSongs：当前打开的正是该歌单时重载
 */
export function invalidateLibrary(kind, payload = {}) {
  if (kind === 'liked') return refreshLikedSongs({ silent: true }).catch(() => {})
  if (kind === 'playlists') return importUserPlaylists().catch(() => {})
  if (kind === 'albums') return refreshAlbums({ silent: true }).catch(() => {})
  if (kind === 'playlistSongs' && payload.id && state.playlist && String(state.playlist.id) === String(payload.id)) {
    return loadPlaylist(payload.id).catch(() => {})
  }
  return Promise.resolve()
}
