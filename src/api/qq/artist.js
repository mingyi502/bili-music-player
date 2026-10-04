/**
 * 歌手页：详情 + 热门 / 单曲 / 专辑 / 相似歌手。
 *
 * 接口（musicu，2026-09 实测可用）：
 * - `music.web_singer_info_svr/get_singer_detail_info`  { singermid, num, begin } → singer_info + singer_brief + songlist（热门）
 * - `musichall.song_list_server/GetSingerSongList`       { singerMid, begin, num, order } → songList[].songInfo
 * - `music.musichallAlbum.AlbumListServer/GetAlbumList`  { singerMid, begin, num, order } → albumList[]
 * - `music.SimilarSingerSvr/GetSimilarSingerList`        { singerMid, number } → singerlist[]
 */
import { musicuCall } from './comm.js'
import { mapSong, albumCover, httpsify } from './util.js'

export const SINGER_MODULE = 'music.web_singer_info_svr'

/** 歌手头像（官方写真；不存在时由 AppImage 回退占位） */
export function singerAvatar(mid, size = 300) {
  return mid ? `https://y.gtimg.cn/music/photo_new/T001R${size}x${size}M000${mid}.jpg` : ''
}

/** 歌手详情响应 → `{ info, hotSongs }` */
export function parseArtistDetail(data) {
  const s = data?.singer_info || {}
  const list = Array.isArray(data?.songlist) ? data.songlist : []
  return {
    info: {
      id: String(s.id || ''),
      mid: s.mid || '',
      name: s.name || '未知歌手',
      otherName: s.other_name || '',
      fans: Number(s.fans) || 0,
      brief: String(data?.singer_brief || ''),
      totalSong: Number(data?.total_song) || 0,
      totalAlbum: Number(data?.total_album) || 0,
      totalMv: Number(data?.total_mv) || 0,
      avatar: singerAvatar(s.mid),
    },
    hotSongs: list.map(mapSong),
  }
}

/** 歌手单曲响应 → `{ songs, total }` */
export function parseArtistSongs(data) {
  const list = Array.isArray(data?.songList) ? data.songList : []
  return {
    songs: list.map((i) => mapSong(i?.songInfo || i)).filter((s) => s.mid || s.id),
    total: Number(data?.totalNum) || 0,
  }
}

/** 歌手专辑响应 → `{ albums, total }` */
export function parseArtistAlbums(data) {
  const list = Array.isArray(data?.albumList) ? data.albumList : []
  return {
    albums: list.map((a) => ({
      id: String(a.albumID || a.albumMid || ''),
      mid: a.albumMid || '',
      name: a.albumName || a.albumTranName || '未知专辑',
      cover: albumCover(a.albumMid, 300),
      pubtime: a.publishDate || '',
      songCount: Number(a.totalNum) || 0,
    })),
    total: Number(data?.total) || 0,
  }
}

/** 相似歌手响应 → 歌手数组 */
export function parseSimilarArtists(data) {
  const list = Array.isArray(data?.singerlist) ? data.singerlist : []
  return list.map((s) => ({
    id: String(s.singerId || ''),
    mid: s.singerMid || '',
    name: s.singerName || '未知歌手',
    avatar: httpsify(s.singerPic) || singerAvatar(s.singerMid),
  }))
}

/** 歌手详情（含热门单曲） */
export async function fetchArtistDetail(mid, { hotNum = 24, begin = 0, cookie, uin, timeout = 15000 } = {}) {
  const data = await musicuCall(SINGER_MODULE, 'get_singer_detail_info', { singermid: mid, num: hotNum, begin }, { cookie, uin, timeout })
  return parseArtistDetail(data)
}

/** 歌手单曲（分页，order=1 按热度） */
export async function fetchArtistSongs(mid, { begin = 0, num = 30, order = 1, cookie, uin, timeout = 15000 } = {}) {
  const data = await musicuCall('musichall.song_list_server', 'GetSingerSongList', { singerMid: mid, begin, num, order }, { cookie, uin, timeout })
  return parseArtistSongs(data)
}

/** 歌手专辑（分页） */
export async function fetchArtistAlbums(mid, { begin = 0, num = 20, order = 1, cookie, uin, timeout = 15000 } = {}) {
  const data = await musicuCall('music.musichallAlbum.AlbumListServer', 'GetAlbumList', { singerMid: mid, begin, num, order }, { cookie, uin, timeout })
  return parseArtistAlbums(data)
}

/** 相似歌手 */
export async function fetchSimilarArtists(mid, { number = 12, cookie, uin, timeout = 15000 } = {}) {
  const data = await musicuCall('music.SimilarSingerSvr', 'GetSimilarSingerList', { singerMid: mid, number }, { cookie, uin, timeout })
  return parseSimilarArtists(data)
}
