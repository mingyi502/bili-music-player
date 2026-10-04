/**
 * 「我喜欢」红心（P4.1 / D1）。
 *
 * 读：musicu `music.musicasset.SongFavRead/IsSongFanByMid`，参数 `v_songMid: [...]`，
 *     响应 `data.m_fan[mid] = true/false`（批量回显）。
 * 写：musicu `music.musicasset.PlaylistDetailWrite/AddSonglist|DelSonglist`，
 *     固定 `dirId: 201`（我喜欢）、`tid: 0`，`v_songInfo: [{ songId, songType }]`
 *     （**数字 songId**，不是 mid）；写失败/受限由 writeCall 统一映射。
 */
import { musicuCall } from './comm.js'
import { mapCover } from './util.js'
import { writeCall, songWriteInfo } from './write.js'

export const LIKED_DIR_ID = 201
export const FAV_READ_MODULE = 'music.musicasset.SongFavRead'
export const FAV_WRITE_MODULE = 'music.musicasset.PlaylistDetailWrite'

/** `data.m_fan` → `{ [mid]: boolean }` */
export function parseFavStates(data) {
  const map = data?.m_fan || {}
  const out = {}
  for (const [mid, v] of Object.entries(map)) out[mid] = !!v
  return out
}

/** 批量查询红心状态（mid 列表） */
export async function fetchFavStates(mids, { cookie, uin, timeout = 15000 } = {}) {
  const list = [...new Set((mids || []).filter(Boolean))]
  if (!list.length) return {}
  const data = await musicuCall(FAV_READ_MODULE, 'IsSongFanByMid', { v_songMid: list }, { cookie, uin, timeout })
  return parseFavStates(data)
}

/**
 * 构造写参数：`songId` 必须是数字 ID；`songType` 缺省 13（QQ 常规歌曲）。
 * @throws 缺少数字 ID 时抛错（避免发出必然失败的请求）
 */
export function buildFavSongParam(song) {
  const info = songWriteInfo(song)
  return { songId: info.songId, songType: info.songType }
}

export function buildFavPayload(song) {
  return { dirId: LIKED_DIR_ID, tid: 0, bFmtUtf8: true, v_songInfo: [buildFavSongParam(song)] }
}

/** 加入「我喜欢」 */
export async function addFav(song, { cookie, uin } = {}) {
  return writeCall(FAV_WRITE_MODULE, 'AddSonglist', buildFavPayload(song), { cookie, uin, label: '收藏' })
}

/** 取消「我喜欢」 */
export async function delFav(song, { cookie, uin } = {}) {
  return writeCall(FAV_WRITE_MODULE, 'DelSonglist', buildFavPayload(song), { cookie, uin, label: '取消收藏' })
}

// ---------------------------------------------------------------------------
// D2 收藏专辑 / D3 收藏歌单（2026-09-25 真机验证参数）
// ---------------------------------------------------------------------------

export const ALBUM_FAV_MODULE = 'music.musicasset.AlbumFavWrite'
export const PLAYLIST_FAV_MODULE = 'music.musicasset.PlaylistFavWrite'

/** 收藏写响应 → `{ ok, failed }`（`result=0` 且无失败项才算成功） */
export function parseFavWriteResult(data, failKey) {
  const failed = data?.[failKey] || []
  return { ok: Number(data?.result) === 0 && failed.length === 0, failed }
}

/** 收藏/取消专辑的参数（**数字 albumId**，非 mid） */
export function buildAlbumFavParam(albumId) {
  const id = Number(albumId) || 0
  if (!id) throw new Error('缺少专辑数字 ID，无法收藏')
  return { v_albumId: [id] }
}

/** 收藏/取消歌单的参数（需要加密 uin + 数字 disstid） */
export function buildPlaylistFavParam(disstid, euin) {
  const id = Number(disstid) || 0
  if (!id) throw new Error('缺少歌单 ID，无法收藏')
  if (!euin) throw new Error('缺少加密账号标识（euin），无法收藏歌单')
  return { uin: euin, v_playlistId: [id] }
}

/** 收藏专辑 */
export async function favAlbum(albumId, { cookie, uin } = {}) {
  const data = await writeCall(ALBUM_FAV_MODULE, 'FavAlbum', buildAlbumFavParam(albumId), { cookie, uin, label: '收藏专辑' })
  return parseFavWriteResult(data, 'v_failedAlbumId')
}
/** 取消收藏专辑 */
export async function cancelFavAlbum(albumId, { cookie, uin } = {}) {
  const data = await writeCall(ALBUM_FAV_MODULE, 'CancelFavAlbum', buildAlbumFavParam(albumId), { cookie, uin, label: '取消收藏专辑' })
  return parseFavWriteResult(data, 'v_failedAlbumId')
}

/** 收藏歌单（到「我的音乐」） */
export async function favPlaylist(disstid, euin, { cookie, uin } = {}) {
  const data = await writeCall(PLAYLIST_FAV_MODULE, 'FavPlaylist', buildPlaylistFavParam(disstid, euin), { cookie, uin, label: '收藏歌单' })
  return parseFavWriteResult(data, 'v_failedPlaylistId')
}

/** 取消收藏歌单 */
export async function cancelFavPlaylist(disstid, euin, { cookie, uin } = {}) {
  const data = await writeCall(PLAYLIST_FAV_MODULE, 'CancelFavPlaylist', buildPlaylistFavParam(disstid, euin), { cookie, uin, label: '取消收藏歌单' })
  return parseFavWriteResult(data, 'v_failedPlaylistId')
}

// ---------------------------------------------------------------------------
// D3 读取：musicu `music.musicasset.PlaylistFavRead/CgiGetPlaylistFavInfo`
// `{ uin: 加密uin, offset, size }` → `data.playlists`（与 FavPlaylist 写同一数据源；
// 旧接口 fcg_get_profile_order_asset 不反映该写入，2026-09-25 真机复验发现）
// ---------------------------------------------------------------------------

export const PLAYLIST_FAV_READ_MODULE = 'music.musicasset.PlaylistFavRead'

/** 收藏歌单响应 → 内部歌单结构（kind='collected'）；实测字段：`v_list[].tid/dirId/name/songnum/logo/nickname` */
export function parsePlaylistFavList(data) {
  const raw = data?.v_list || data?.playlists || data?.v_playlist || data?.list || []
  return raw
    .map((p) => ({
      id: String(p.tid || p.dissid || p.dirid || p.id || ''),
      name: p.name || p.dissname || p.title || '未命名歌单',
      cover: mapCover(p.logo || p.picurl || p.diss_cover || '', 300),
      songCount: Number(p.songnum || p.song_count || p.song_cnt) || 0,
      listenNum: Number(p.listen_num || p.listennum) || 0,
      nick: p.nickname || p.nick || '',
      kind: 'collected',
    }))
    .filter((p) => p.id)
}

/** 分页拉取收藏歌单（需加密 uin；单页 ≤50） */
export async function fetchPlaylistFavs(euin, { cookie, uin, size = 50, max = 500, timeout = 15000 } = {}) {
  const key = String(euin || '')
  if (!key) throw new Error('缺少加密账号标识（euin），无法读取收藏歌单')
  const out = []
  let offset = 0
  while (out.length < max) {
    const data = await musicuCall(PLAYLIST_FAV_READ_MODULE, 'CgiGetPlaylistFavInfo', { uin: key, offset, size }, { cookie, uin, timeout })
    const page = parsePlaylistFavList(data)
    out.push(...page)
    if (page.length < size) break
    if (data?.hasmore === false || data?.hasMore === false) break
    const total = Number(data?.total) || 0
    if (total && out.length >= total) break
    offset += size
  }
  return out.slice(0, max)
}
