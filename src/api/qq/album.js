/** 专辑相关：收藏的专辑列表、专辑详情与歌曲。 */
import { request, mapSong, mapAlbum, mapCover, albumCover } from './util.js'
import { postMusicu, buildComm, musicuCall } from './comm.js'

export const ALBUM_MODULE = 'music.musichallAlbum.AlbumInfoServer'

async function fetchAlbumPage(uin, euin, cookie, offset, size) {
  const payload = {
    comm: buildComm({ uin }),
    req_0: {
      module: 'music.musicasset.AlbumFavRead',
      method: 'CgiGetAlbumFavInfo',
      param: { euin: euin || '', offset, size },
    },
  }
  const data = await postMusicu(payload, cookie)
  const req = data.req_0 || data.req || {}
  if (data.code && data.code !== 0) throw new Error(`网关返回 code=${data.code}`)
  if (req.code !== undefined && req.code !== 0) {
    throw new Error(`专辑接口返回 code=${req.code}${req.msg ? ` ${req.msg}` : ''}`)
  }
  const raw = req.data?.v_list || req.data?.albums || req.data?.albumlist || req.data?.v_album || []
  const total = Number(req.data?.total)
  return { raw, total: Number.isFinite(total) ? total : null, hasmore: req.data?.hasmore }
}

/** 获取收藏的专辑，分页拉全 */
export async function fetchUserAlbums(uin, euin, cookie, { pageSize = 100, max = 5000 } = {}) {
  const albums = []
  const seen = new Set()
  let offset = 0
  let total = null
  let pages = 0
  while (offset < max) {
    const { raw, total: t, hasmore } = await fetchAlbumPage(uin, euin, cookie, offset, pageSize)
    pages++
    if (t !== null) total = t
    if (!raw.length) break
    for (const a of raw) {
      const mapped = mapAlbum(a)
      if (seen.has(mapped.mid)) continue
      seen.add(mapped.mid)
      albums.push(mapped)
    }
    offset += raw.length
    if (total !== null && albums.length >= total) break
    if (hasmore === false || hasmore === 0 || hasmore === '0') break
    if (pages >= 100) break
  }
  return { albums, total: total ?? albums.length, pages }
}

/** 获取专辑详情与歌曲（旧版 c.y.qq.com 接口） */export async function fetchAlbumSongs(albumMid, cookie) {
  if (!albumMid) throw new Error('专辑缺少 albummid')
  const data = await request(
    '/v8/fcg-bin/fcg_v8_album_info_cp.fcg',
    {
      albummid: albumMid,
      g_tk: 5381,
      loginUin: 0,
      hostUin: 0,
      format: 'json',
      inCharset: 'utf8',
      outCharset: 'utf-8',
      notice: 0,
      platform: 'yqq.json',
      needNewCode: 0,
    },
    cookie
  )
  if (data.code !== 0) throw new Error(data.message || `专辑详情返回 code=${data.code}`)
  const d = data.data || {}
  const songs = (d.list || []).map(mapSong)
  return {
    playlist: {
      id: `album:${albumMid}`,
      name: d.name || '未知专辑',
      cover: mapCover(d.pic, 300) || albumCover(albumMid, 300),
      songCount: songs.length,
      nick: d.singername || '',
      desc: d.desc || '',
      album: true,
    },
    songs,
  }
}

/** musicu 专辑详情响应 → 内部元信息（公司 / 流派 / 语种 / 简介等增强） */
export function parseAlbumDetail(data) {
  const b = data?.basicInfo || {}
  const singers = (data?.singer?.singerList || []).map((s) => s.singerName || s.name).filter(Boolean)
  return {
    id: String(b.albumID || ''),
    mid: b.albumMid || '',
    name: b.albumName || '未知专辑',
    tranName: b.tranName || '',
    cover: albumCover(b.albumMid, 300),
    pubtime: b.publishDate || '',
    desc: b.desc || '',
    genre: b.genre || '',
    language: b.language || '',
    company: data?.company?.name || '',
    singers,
  }
}

/** 专辑详情（musicu `music.musichallAlbum.AlbumInfoServer/GetAlbumDetail`，参数名是 `albumMId`） */
export async function fetchAlbumDetail(albumMid, { cookie, uin, timeout = 15000 } = {}) {
  if (!albumMid) throw new Error('专辑缺少 albummid')
  const data = await musicuCall(ALBUM_MODULE, 'GetAlbumDetail', { albumMId: albumMid }, { cookie, uin, timeout })
  return parseAlbumDetail(data)
}