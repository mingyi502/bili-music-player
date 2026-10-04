/**
 * D2 收藏专辑 / D3 收藏歌单（P4.2 / P4.3）。
 *
 * 参数已由源码 + 真机验证（2026-09-25）：
 * - 专辑：`AlbumFavWrite/FavAlbum|CancelFavAlbum` `{ v_albumId: [数字 albumId] }`
 * - 歌单：`PlaylistFavWrite/FavPlaylist|CancelFavPlaylist` `{ uin: 加密uin, v_playlistId: [数字 disstid] }`
 * 状态回显：专辑用 `state.albums`（收藏专辑列表），歌单用 `state.playlists` 中 kind='collected' 的项。
 */
import { state } from './state.js'
import { toast } from './ui.js'
import { ensureWritable, toastWriteError } from './write.js'
import { favAlbum, cancelFavAlbum, favPlaylist, cancelFavPlaylist } from '../api/qq/fav.js'
import { invalidateLibrary, ensureEuin } from './library.js'

const opts = () => ({ cookie: state.config.qqCookie, uin: state.config.uin })

/** 专辑是否已收藏（按数字 id 或 mid 匹配本地缓存） */
export function isAlbumFav(album) {
  if (!album) return false
  return state.albums.some(
    (a) => (album.id && String(a.id) === String(album.id)) || (album.mid && a.mid === album.mid)
  )
}

/** 歌单是否已收藏（kind='collected'） */
export function isPlaylistFav(playlist) {
  if (!playlist) return false
  return state.playlists.some((p) => p.kind === 'collected' && String(p.id) === String(playlist.id))
}

/** 切换专辑收藏（乐观更新 + 失败回滚 + 刷新收藏专辑列表） */
export async function toggleFavAlbum(album) {
  if (!album) return null
  const albumId = Number(album.id) || 0
  if (!albumId) {
    toast('该专辑缺少数字 ID，无法收藏', 'error')
    return null
  }
  if (!ensureWritable()) return null
  const wasFav = isAlbumFav(album)
  // 乐观更新（补齐 singers 等渲染必需字段，避免侧栏等位置报错）
  const optimistic = { singers: [], songCount: 0, ...album, kind: 'collected' }
  if (wasFav) {
    state.albums = state.albums.filter((a) => !(String(a.id) === String(album.id) || (album.mid && a.mid === album.mid)))
  } else {
    state.albums = [optimistic, ...state.albums]
  }
  try {
    const res = wasFav ? await cancelFavAlbum(albumId, opts()) : await favAlbum(albumId, opts())
    if (res && res.ok === false) throw new Error(`上游拒绝了收藏操作（失败 ${res.failed?.length || 0} 项）`)
    toast(wasFav ? `已取消收藏专辑《${album.name}》` : `已收藏专辑《${album.name}》`, 'success')
    invalidateLibrary('albums')
    return { fav: !wasFav }
  } catch (e) {
    // 回滚
    if (wasFav) state.albums = [optimistic, ...state.albums]
    else state.albums = state.albums.filter((a) => !(String(a.id) === String(album.id) || (album.mid && a.mid === album.mid)))
    toastWriteError(e)
    return null
  }
}

/** 切换歌单收藏（乐观更新 + 失败回滚 + 刷新侧栏歌单） */
export async function toggleFavPlaylist(playlist) {
  if (!playlist) return null
  const id = Number(playlist.id) || 0
  if (!id) {
    toast('该歌单缺少 ID，无法收藏', 'error')
    return null
  }
  if (!ensureWritable()) return null
  const wasFav = isPlaylistFav(playlist)
  const optimistic = {
    id: String(playlist.id),
    name: playlist.name || '未命名歌单',
    cover: playlist.cover || '',
    songCount: playlist.songCount || 0,
    listenNum: playlist.listenNum || 0,
    kind: 'collected',
  }
  if (wasFav) state.playlists = state.playlists.filter((p) => !(p.kind === 'collected' && String(p.id) === String(playlist.id)))
  else state.playlists = [...state.playlists, optimistic]
  try {
    const euin = await ensureEuin()
    const res = wasFav ? await cancelFavPlaylist(id, euin, opts()) : await favPlaylist(id, euin, opts())
    if (res && res.ok === false) throw new Error(`上游拒绝了收藏操作（失败 ${res.failed?.length || 0} 项）`)
    toast(wasFav ? `已取消收藏歌单《${playlist.name}》` : `已收藏歌单《${playlist.name}》`, 'success')
    invalidateLibrary('playlists')
    return { fav: !wasFav }
  } catch (e) {
    if (wasFav) state.playlists = [...state.playlists, optimistic]
    else state.playlists = state.playlists.filter((p) => !(p.kind === 'collected' && String(p.id) === String(playlist.id)))
    toastWriteError(e)
    return null
  }
}
