/**
 * 「我喜欢」红心状态（P4.1）：状态缓存 + 乐观切换。
 *
 * - `refreshFavStates(songs)`：批量回显（静默失败，不影响播放）
 * - `toggleFav(song)`：无票据先提示登录；有票据则乐观更新 → 写接口 → 失败回滚
 * - 写成功后 `invalidateLibrary('liked')` 刷新「我喜欢」列表与计数
 */
import { state, songKey } from './state.js'
import { toast } from './ui.js'
import { ensureWritable, toastWriteError } from './write.js'
import { fetchFavStates, addFav, delFav } from '../api/qq/fav.js'
import { invalidateLibrary } from './library.js'

/** 当前账号的 IsSongFanByMid 已确认不可用（code=1000）时，避免每次进歌单都再打一轮请求 */
let favReadBlockedUin = ''

/** 该歌曲当前是否为「我喜欢」（未回显时视为 false） */
export function favOf(song) {
  if (!song) return false
  const key = songKey(song)
  // 先看「我喜欢」列表成员（当前账号的 IsSongFanByMid 可能不可用），再看接口回显
  if (state.fav.liked[key] || (song.mid && state.fav.liked[song.mid])) return true
  return !!state.fav.map[key]
}

/** 是否有红心操作正在进行 */
export function favPending(song) {
  if (!song) return false
  return !!state.fav.pending[songKey(song)]
}

/** 批量回显红心状态（按 mid；失败静默） */
export async function refreshFavStates(songs) {
  const list = (songs || []).filter((s) => s?.mid)
  if (!list.length || !state.config.qqCookie) return
  if (favReadBlockedUin && favReadBlockedUin === state.config.uin) return
  const mids = [...new Set(list.map((s) => s.mid))]
  try {
    const map = await fetchFavStates(mids, { cookie: state.config.qqCookie, uin: state.config.uin })
    // 接口返回 false 时不要覆盖「我喜欢」列表已经确认的 true
    for (const song of list) {
      if (state.fav.liked[songKey(song)] || (song.mid && state.fav.liked[song.mid])) map[song.mid] = true
    }
    Object.assign(state.fav.map, map)
  } catch (e) {
    /* 回显失败不打断播放 */
    if (/1000|未登录|登录已失效/.test(String(e?.message || ''))) favReadBlockedUin = state.config.uin
  }
}

function setLikedFlag(song, value) {
  const key = songKey(song)
  if (value) {
    state.fav.liked[key] = true
    if (song.mid) state.fav.liked[song.mid] = true
  } else {
    delete state.fav.liked[key]
    if (song.mid) delete state.fav.liked[song.mid]
  }
}

/** 切换「我喜欢」：乐观更新 + 失败回滚 */
export async function toggleFav(song) {
  if (!song || !(song.mid || song.id)) return
  if (!ensureWritable()) return
  const key = songKey(song)
  if (state.fav.pending[key]) return
  const prev = favOf(song)
  const next = !prev
  state.fav.map[key] = next
  setLikedFlag(song, next)
  state.fav.pending[key] = true
  try {
    if (next) await addFav(song, { cookie: state.config.qqCookie, uin: state.config.uin })
    else await delFav(song, { cookie: state.config.qqCookie, uin: state.config.uin })
    toast(next ? `已加入「我喜欢」：${song.name}` : `已从「我喜欢」移除：${song.name}`, 'success')
    invalidateLibrary('liked')
  } catch (e) {
    state.fav.map[key] = prev
    setLikedFlag(song, prev)
    toastWriteError(e)
  } finally {
    state.fav.pending[key] = false
  }
}
