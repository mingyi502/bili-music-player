/**
 * 歌单写操作（P4.4 创建 / P4.6 删除 / P4.7 加歌·删歌）。
 *
 * 真机实测（2026-09-24，签名网关 + 有效 qm_keyst）：
 * - `PlaylistBaseWrite/AddPlaylist`  `{ dirName, dirDesc, dirPicUrl, taglist }`
 *   → `data.result = { dirId, tid, dirName, ... }`（新歌单 dirId 为小序号，tid 为公开 id）
 * - `PlaylistBaseWrite/DelPlaylist`  `{ dirId }` → `data.retCode = 0`
 * - `PlaylistDetailWrite/AddSonglist|DelSonglist` `{ dirId, tid, bFmtUtf8, v_songInfo:[{songId,songType}] }`
 *   → `data.result.songlist[].existed`（0 新增 / 1 已存在）；批量 ≤50 首/批、批间隔 500ms
 *
 * 未打通（参数/模块未破解，见 ROADMAP 第 5 节）：收藏专辑、收藏歌单、歌单改名、云历史、关注歌手。
 */
import { writeCall, songWriteInfo } from './write.js'

export { songWriteInfo }

export const PLAYLIST_BASE_MODULE = 'music.musicasset.PlaylistBaseWrite'
export const PLAYLIST_DETAIL_MODULE = 'music.musicasset.PlaylistDetailWrite'

/** 单批上限与批间隔（上游限制） */
export const BATCH_SIZE = 50
export const BATCH_DELAY_MS = 500

/** 数组按 size 分块（纯函数，便于单测） */
export function chunk(list, size = BATCH_SIZE) {
  const out = []
  for (let i = 0; i < (list || []).length; i += size) out.push(list.slice(i, i + size))
  return out
}

/** 创建歌单响应 → `{ dirId, tid, name }` */
export function parseCreateResult(data) {
  const r = data?.result || data || {}
  return {
    dirId: Number(r.dirId) || 0,
    tid: Number(r.tid) || 0,
    name: r.dirName || '',
  }
}

/** 加歌/删歌响应 → `{ added, existed, failed }`（按 existed 统计） */
export function parseSongWriteResult(data) {
  const list = data?.result?.songlist || []
  let added = 0
  let existed = 0
  for (const item of list) {
    if (Number(item.existed) === 1) existed += 1
    else added += 1
  }
  return { added, existed, failed: Math.max(0, (data?.result?.v_failSongInfo || []).length) }
}

/** 创建歌单 */
export async function createPlaylist(name, { desc = '', cookie, uin } = {}) {
  const dirName = String(name || '').trim()
  if (!dirName) throw new Error('歌单名不能为空')
  const data = await writeCall(
    PLAYLIST_BASE_MODULE,
    'AddPlaylist',
    { dirName, dirDesc: desc || '', dirPicUrl: '', taglist: [] },
    { cookie, uin, label: '创建歌单' }
  )
  return parseCreateResult(data)
}

/** 删除歌单（只能用 dirId） */
export async function deletePlaylist(dirId, { cookie, uin } = {}) {
  const id = Number(dirId) || 0
  if (!id) throw new Error('缺少歌单 dirId，无法删除')
  return writeCall(PLAYLIST_BASE_MODULE, 'DelPlaylist', { dirId: id }, { cookie, uin, label: '删除歌单' })
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * 批量加歌/删歌（≤50 首/批，批间隔 500ms）。
 * @param {string} method 'AddSonglist' | 'DelSonglist'
 * @param {Array} songs
 * @returns {{ added:number, existed:number, failed:number, batches:number }}
 */
export async function writeSongsToPlaylist(method, dirId, tid, songs, { cookie, uin, onProgress } = {}) {
  const id = Number(dirId) || 0
  const tidNum = Number(tid) || 0
  if (!id) throw new Error('缺少歌单 dirId，无法写入')
  const infos = (songs || []).map(songWriteInfo)
  if (!infos.length) throw new Error('没有可写入的歌曲')
  const batches = chunk(infos, BATCH_SIZE)
  const total = { added: 0, existed: 0, failed: 0, batches: batches.length }
  for (let i = 0; i < batches.length; i++) {
    const data = await writeCall(
      PLAYLIST_DETAIL_MODULE,
      method,
      { dirId: id, tid: tidNum, bFmtUtf8: true, v_songInfo: batches[i] },
      { cookie, uin, label: method === 'AddSonglist' ? '加入歌单' : '移出歌单' }
    )
    const stat = parseSongWriteResult(data)
    total.added += stat.added
    total.existed += stat.existed
    total.failed += stat.failed
    onProgress?.(i + 1, batches.length)
    if (i < batches.length - 1) await sleep(BATCH_DELAY_MS)
  }
  return total
}

/** 批量加歌 */
export function addSongsToPlaylist(dirId, tid, songs, opts = {}) {
  return writeSongsToPlaylist('AddSonglist', dirId, tid, songs, opts)
}

/** 批量删歌 */
export function removeSongsFromPlaylist(dirId, tid, songs, opts = {}) {
  return writeSongsToPlaylist('DelSonglist', dirId, tid, songs, opts)
}
