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

/** 该歌曲当前是否为「我喜欢」（未回显时视为 false） */
export function favOf(song) {
  if (!song) return false
  return !!state.fav.map[songKey(song)]
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
  const mids = [...new Set(list.map((s) => s.mid))]
  try {
    const map = await fetchFavStates(mids, { cookie: state.config.qqCookie, uin: state.config.uin })
    Object.assign(state.fav.map, map)
  } catch {
    /* 回显失败不打断播放 */
  }
}

/** 切换「我喜欢」：乐观更新 + 失败回滚 */
export async function toggleFav(song) {
  if (!song || !(song.mid || song.id)) return
  if (!ensureWritable()) return
  const key = songKey(song)
  if (state.fav.pending[key]) return
  const prev = !!state.fav.map[key]
  const next = !prev
  state.fav.map[key] = next
  state.fav.pending[key] = true
  try {
    if (next) await addFav(song, { cookie: state.config.qqCookie, uin: state.config.uin })
    else await delFav(song, { cookie: state.config.qqCookie, uin: state.config.uin })
    toast(next ? `已加入「我喜欢」：${song.name}` : `已从「我喜欢」移除：${song.name}`, 'success')
    invalidateLibrary('liked')
  } catch (e) {
    state.fav.map[key] = prev
    toastWriteError(e)
  } finally {
    state.fav.pending[key] = false
  }
}
