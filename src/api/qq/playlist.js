/** 歌单相关：「我喜欢」（dirid=201）与普通歌单详情。 */
import { mapSong, mapCover, parsePlaylistId } from './util.js'
import { postMusicu, buildComm, musicuCall } from './comm.js'

async function fetchLikedPage(uin, euin, cookie, begin, num) {
  // 注意：这里传对象给 postMusicu，它会负责 JSON.stringify；不要在这里再序列化一次
  const payload = {
    comm: buildComm({ uin }),
    req_0: {
      module: 'music.srfDissInfo.DissInfo',
      method: 'CgiGetDiss',
      param: {
        disstid: 0,
        dirid: 201,
        tag: true,
        song_begin: begin,
        song_num: num,
        userinfo: true,
        orderlist: true,
        enc_host_uin: euin || '',
      },
    },
  }
  const res = await postMusicu(payload, cookie)
  const req = res.req_0 || res.req || {}
  if (res.code && res.code !== 0) throw new Error(`网关返回 code=${res.code}`)
  if (req.code !== undefined && req.code !== 0) {
    throw new Error(`我喜欢接口返回 code=${req.code}${req.subcode ? `/${req.subcode}` : ''}${req.msg ? ` ${req.msg}` : ''}`)
  }
  const raw = req.data?.songlist || req.data?.songs || []
  const total = Number(req.data?.total)
  const hasmore = req.data?.hasmore
  return { raw, total: Number.isFinite(total) ? total : null, hasmore }
}

/**
 * 获取「我喜欢的音乐」（dirid=201 的特殊列表），走新版网关 musicu.fcg。
 * 分页拉全：接口单页有上限，必须循环 song_begin 才能拿到全部（例如 647 首）。
 */
export async function fetchLikedSongs(uin, euin, cookie, { pageSize = 100, max = 20000 } = {}) {
  const songs = []
  const seen = new Set()
  let begin = 0
  let total = null
  let pages = 0
  let size = pageSize

  while (begin < max) {
    let page
    try {
      page = await fetchLikedPage(uin, euin, cookie, begin, size)
    } catch (e) {
      // 页大小可能被服务端拒绝（>100 时），降级到 30 再试一次
      if (size > 30) {
        size = 30
        continue
      }
      throw e
    }
    const { raw, total: t, hasmore } = page
    pages++
    if (t !== null) total = t
    if (!raw.length) break
    for (const s of raw) {
      const mapped = mapSong(s)
      const key = mapped.mid || mapped.id || `${mapped.name}|${mapped.singers.join(',')}`
      if (seen.has(key)) continue
      seen.add(key)
      songs.push(mapped)
    }
    begin += raw.length
    if (total !== null && songs.length >= total) break
    if (hasmore === false || hasmore === 0 || hasmore === '0') break
    if (raw.length < size && (total === null || songs.length >= total)) break
    if (pages >= 400) break
  }

  return { songs, total: total ?? songs.length, pages }
}

/**
 * 获取歌单详情与歌曲列表（公有 / 私有歌单，经粘贴链接与广场进入）。
 *
 * 实测（2026-09）：老接口 `fcg_ucc_getcdinfo_byids_cp.fcg` 已返回空 `cdlist`；
 * 改走 musicu `music.srfDissInfo.DissInfo/CgiGetDiss`（与「我喜欢」同模块），
 * 单页上限有限，按 `song_begin` 循环拉全。
 */
export async function fetchPlaylistSongs(disstid, cookie, uin) {
  const id = parsePlaylistId(disstid)
  if (!id) throw new Error('请输入正确的歌单链接或 id')
  const pageSize = 200
  let songs = []
  let dir = null
  let begin = 0
  for (let page = 0; page < 50; page++) {
    const data = await musicuCall(
      'music.srfDissInfo.DissInfo',
      'CgiGetDiss',
      { disstid: Number(id), dirid: 0, tag: true, song_begin: begin, song_num: pageSize, userinfo: true },
      { cookie, uin, timeout: 20000 }
    )
    dir = data?.dirinfo || dir
    const batch = (data?.songlist || []).map(mapSong)
    songs = songs.concat(batch)
    const total = Number(dir?.songnum) || Number(data?.songlist_size) || 0
    begin += batch.length || pageSize
    if (!batch.length || (total && songs.length >= total)) break
  }
  if (!dir?.id) throw new Error('未找到该歌单，若为私密歌单请先配置 QQ 音乐 Cookie')

  return {
    playlist: {
      id: String(dir.id || id),
      name: dir.title || '未命名歌单',
      cover: mapCover(dir.picurl, 300) || songs[0]?.cover?.replace('150x150', '300x300') || '',
      songCount: Number(dir.songnum) || songs.length,
      desc: dir.desc || '',
      nick: dir.host_nick || dir.creator?.nick || '',
      listenNum: Number(dir.listennum) || 0,
      updateTime: dir.mtime ? new Date(dir.mtime * 1000).toISOString().slice(0, 10) : '',
    },
    songs,
  }
}
