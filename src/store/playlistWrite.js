/**
 * 歌单写操作 store（P4.4 / P4.6 / P4.7）：创建、删除、加歌、删歌、加入歌单选择器。
 * 统一：票据守卫 → 写接口 → toast → 缓存失效（正在浏览的歌单会刷新）。
 */
import { state } from './state.js'
import { toast, askConfirm, askPrompt } from './ui.js'
import { ensureWritable, toastWriteError } from './write.js'
import {
  createPlaylist as apiCreatePlaylist,
  deletePlaylist as apiDeletePlaylist,
  addSongsToPlaylist as apiAddSongs,
  removeSongsFromPlaylist as apiRemoveSongs,
} from '../api/qq/playlistWrite.js'
import { fetchPlaylistSongs } from '../api/qq.js'
import { invalidateLibrary } from './library.js'

const opts = () => ({ cookie: state.config.qqCookie, uin: state.config.uin })

/** 轻量刷新当前浏览歌单的歌曲（不重建队列，避免打断播放） */
async function refreshCurrentSongs() {
  if (!state.playlist) return
  try {
    const { songs } = await fetchPlaylistSongs(state.playlist.id, state.config.qqCookie, state.config.uin)
    state.songs = songs
  } catch {
    /* 刷新失败保留原列表 */
  }
}

/** 当前正在浏览的歌单若属于「创建的歌单」，返回 `{ dirId, tid, name }`，否则 null */
export function currentCreatedPlaylist() {
  const cur = state.playlist
  if (!cur || cur.id === 'liked') return null
  const hit = state.playlists.find((p) => String(p.id) === String(cur.id))
  if (!hit || !hit.dirId) return null
  return { dirId: Number(hit.dirId) || 0, tid: Number(hit.id) || 0, name: hit.name || cur.name || '' }
}

/** 新建歌单（带输入弹窗） */
export async function createPlaylist() {
  if (!ensureWritable()) return null
  const name = await askPrompt({ title: '新建歌单', placeholder: '输入歌单名称', confirmText: '创建' })
  if (name === null) return null
  const trimmed = String(name).trim()
  if (!trimmed) {
    toast('歌单名不能为空', 'error')
    return null
  }
  try {
    const res = await apiCreatePlaylist(trimmed, opts())
    // 乐观更新：侧栏立即出现（随后 invalidateLibrary 会以服务端结果为准刷新）
    if (res.dirId) {
      state.playlists = [
        ...state.playlists,
        { id: String(res.tid || ''), name: res.name || trimmed, cover: '', songCount: 0, listenNum: 0, dirId: res.dirId, kind: 'created' },
      ]
    }
    toast(`已创建歌单《${res.name || trimmed}》`, 'success')
    await invalidateLibrary('playlists')
    return res
  } catch (e) {
    toastWriteError(e)
    return null
  }
}

/** 删除歌单（二次确认；若正在浏览该歌单则清空视图） */
export async function deletePlaylist(dirId, name = '') {
  if (!ensureWritable()) return false
  const ok = await askConfirm({
    title: '删除歌单',
    message: `将删除歌单${name ? `《${name}》` : ''}（歌单内的歌曲不会被删除）。`,
    confirmText: '删除',
    danger: true,
  })
  if (!ok) return false
  try {
    await apiDeletePlaylist(dirId, opts())
    // 乐观更新：先从侧栏移除（随后 invalidateLibrary 以服务端结果为准）
    state.playlists = state.playlists.filter((p) => String(p.dirId) !== String(dirId))
    if (state.playlist && String(state.playlist.id) === String(currentTidFor(dirId))) {
      state.playlist = null
      state.songs = []
    }
    toast('歌单已删除', 'success')
    await invalidateLibrary('playlists')
    return true
  } catch (e) {
    toastWriteError(e)
    return false
  }
}

/** dirId → 本地已加载歌单里的 tid（用于判断「当前浏览的是否就是被删的那个」） */
function currentTidFor(dirId) {
  const hit = state.playlists.find((p) => String(p.dirId) === String(dirId))
  return hit ? hit.id : ''
}

/** 把歌曲加入指定歌单（批量 ≤50/批）；正在浏览该歌单时自动刷新 */
export async function addSongsToPlaylist(playlist, songs) {
  if (!ensureWritable()) return null
  const list = (songs || []).filter(Boolean)
  if (!list.length) return null
  try {
    const res = await apiAddSongs(playlist.dirId, playlist.tid, list, opts())
    const extra = res.existed ? `，已存在 ${res.existed} 首` : ''
    toast(`已加入《${playlist.name}》：新增 ${res.added} 首${extra}`, res.added ? 'success' : 'info')
    // 乐观更新侧栏计数（后台 invalidate 会以服务端为准）
    if (res.added) {
      state.playlists = state.playlists.map((p) =>
        String(p.dirId) === String(playlist.dirId) ? { ...p, songCount: (Number(p.songCount) || 0) + res.added } : p
      )
    }
    if (state.playlist && String(state.playlist.id) === String(playlist.tid)) refreshCurrentSongs()
    return res
  } catch (e) {
    toastWriteError(e)
    return null
  }
}

/** 从当前创建的歌单中移除歌曲（单曲入口） */
export async function removeSongFromPlaylist(playlist, song) {
  if (!ensureWritable()) return null
  try {
    const res = await apiRemoveSongs(playlist.dirId, playlist.tid, [song], opts())
    toast(`已从《${playlist.name}》移除：${song.name}`, 'success')
    if (res.added) {
      state.playlists = state.playlists.map((p) =>
        String(p.dirId) === String(playlist.dirId) ? { ...p, songCount: Math.max(0, (Number(p.songCount) || 0) - res.added) } : p
      )
    }
    if (state.playlist && String(state.playlist.id) === String(playlist.tid)) {
      state.songs = state.songs.filter((s) => s !== song)
      refreshCurrentSongs()
    }
    return res
  } catch (e) {
    toastWriteError(e)
    return null
  }
}

/** 从当前创建的歌单中批量移除歌曲（选择模式入口；移除前二次确认） */
export async function removeSongsFromPlaylist(playlist, songs) {
  if (!ensureWritable()) return null
  const list = (songs || []).filter(Boolean)
  if (!list.length) return null
  const ok = await askConfirm({
    title: '从歌单移除',
    message: `将从《${playlist.name}》移除 ${list.length} 首歌曲。`,
    confirmText: '移除',
    danger: true,
  })
  if (!ok) return null
  try {
    const res = await apiRemoveSongs(playlist.dirId, playlist.tid, list, opts())
    toast(`已从《${playlist.name}》移除 ${res.added || list.length} 首`, 'success')
    if (res.added) {
      state.playlists = state.playlists.map((p) =>
        String(p.dirId) === String(playlist.dirId) ? { ...p, songCount: Math.max(0, (Number(p.songCount) || 0) - res.added) } : p
      )
    }
    if (state.playlist && String(state.playlist.id) === String(playlist.tid)) {
      const set = new Set(list)
      state.songs = state.songs.filter((s) => !set.has(s))
      refreshCurrentSongs()
    }
    return res
  } catch (e) {
    toastWriteError(e)
    return null
  }
}

// ── 「加入歌单」选择器 ────────────────────────────────────────────────────
export function openPlaylistPicker(songs) {
  const list = (songs || []).filter(Boolean)
  if (!list.length) return
  state.playlistPicker.songs = list
  state.playlistPicker.open = true
}
export function closePlaylistPicker() {
  state.playlistPicker.open = false
  state.playlistPicker.songs = []
}
