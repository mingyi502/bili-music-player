/**
 * QQ 音乐搜索。
 *
 * 实测（2026-09）：musicu 的 `music.search.SearchCgiService/DoSearchForQQMusicDesktop`
 * 已对所有 search_type 返回空列表；`client_search_cp` 被 WAF 拦截（500）。
 * 改走仍可用的经典 CGI（c.y.qq.com/soso/fcgi-bin/）：
 * - 单曲：`search_for_qq_cp?t=0`（JSON）
 * - 专辑：`search_for_qq_cp?t=8`（JSON）
 * - 歌单：`client_music_search_songlist`（JSONP，需剥离回调壳；page_no 从 0 起）
 * - 歌手：没有可用的公开接口（zhida 实体也为空），改为「从单曲结果聚合去重」，
 *         覆盖到常见诉求（搜歌手名 → 列出该歌手的相关单曲所属歌手），但不支持拼音/别名联想。
 *
 * 解析函数（parseSongSearch / parseSonglistSearch / aggregateSingers / stripJsonp）
 * 都是纯函数，便于用 fixture 做单测（见 scripts/platform-test.mjs 第 16 节）。
 */
import { httpRequest, qs } from '../../core/http.js'
import { request as qqGet, albumCover, httpsify, decodeEntities } from './util.js'
import { musicuCall } from './comm.js'

const LEGACY_SEARCH = '/soso/fcgi-bin/search_for_qq_cp'
const SONGLIST_SEARCH = '/soso/fcgi-bin/client_music_search_songlist'
const SMARTBOX = '/splcloud/fcgi-bin/smartbox_new.fcg'

/** 经典 CGI 的 t 值（歌手为历史值，接口已不支持，实际走聚合） */
export const SEARCH_TYPES = { song: 0, album: 8, playlist: 2, singer: 9 }

/** 剥离 JSONP 回调壳；本身就是 JSON 时原样解析 */
export function stripJsonp(text) {
  const s = String(text || '').trim()
  if (!s) throw new Error('QQ音乐搜索返回为空')
  if (s.startsWith('{') || s.startsWith('[')) return JSON.parse(s)
  return JSON.parse(s.replace(/^[^(]*\(/, '').replace(/\)\s*;?\s*$/, ''))
}

/** 搜索单曲条目 → 内部歌曲结构 */
function mapSearchSong(s) {
  const albumMid = s.albummid || s.albumMid || ''
  const singerRefs = (s.singer || [])
    .filter((x) => x && typeof x !== 'string')
    .map((x) => ({ name: x.name, mid: x.mid || '' }))
  return {
    id: String(s.songid || s.id || ''),
    mid: s.songmid || s.mid || '',
    name: s.songname || s.name || '',
    singers: (s.singer || []).map((x) => (typeof x === 'string' ? x : x.name)).filter(Boolean),
    singerRefs,
    album: s.albumname || '',
    albumMid,
    cover: albumCover(albumMid, 150),
    interval: Number(s.interval) || 0,
    mvVid: '',
    /** 写接口需要的歌曲类型（搜索结果里通常是 13） */
    songType: Number(s.songtype ?? s.songType ?? s.type) || 0,
    /** 付费受限（G2） */
    payplay: Number(s.pay?.payplay) || 0,
    hasPreview: !!s.preview,
  }
}

/** 搜索专辑条目 → 内部专辑结构 */
function mapSearchAlbum(a) {
  const mid = a.albumMID || a.albummid || a.albumMid || ''
  const singerName = a.singerName || a.singer_name || ''
  return {
    id: String(a.albumID || a.albumid || mid || ''),
    mid,
    name: a.albumName || a.albumname || '未知专辑',
    singers: singerName ? String(singerName).split('/').map((s) => s.trim()).filter(Boolean) : [],
    cover: albumCover(mid, 300),
    songCount: Number(a.song_count || a.songnum) || 0,
    pubtime: a.publicTime || a.pubtime || '',
  }
}

/** 搜索歌单条目 → 内部歌单结构（id 可直接给 loadPlaylist） */
function mapSearchPlaylist(p) {
  return {
    id: String(p.dissid || p.dirid || p.tid || ''),
    name: decodeEntities(p.dissname || p.diss_name || '未命名歌单'),
    cover: httpsify(p.imgurl || p.diss_cover || p.cover),
    songCount: Number(p.song_count || p.songnum) || 0,
    listenNum: Number(p.listennum || p.listen_num) || 0,
    nick: decodeEntities(p.creator?.name || p.creator?.nick || p.nickname || ''),
  }
}

/**
 * 解析 `search_for_qq_cp` 响应（单曲 / 专辑）。
 * 汇总字段：curnum=本页条数、curpage=当前页、totalnum=总数。
 * @param {{ data?: { song?: object, album?: object } }} json 原始响应（含 data 壳）
 * @param {'song'|'album'} tab
 */
export function parseSongSearch(json, tab = 'song') {
  const node = tab === 'album' ? json?.data?.album : json?.data?.song
  const raw = Array.isArray(node?.list) ? node.list : []
  const list = tab === 'album' ? raw.map(mapSearchAlbum) : raw.map(mapSearchSong)
  const total = Number(node?.totalnum) || 0
  const page = Number(node?.curpage) || 1
  const perPage = Number(node?.curnum) || raw.length || 0
  return { list, total, page, hasMore: raw.length > 0 && perPage > 0 && page * perPage < total }
}

/**
 * 解析 `client_music_search_songlist` 响应（歌单）。
 * 汇总字段：page_no（0 基）、num_per_page、display_num（总数）。
 * @param {{ data?: object }} json 已剥离 JSONP 壳的响应
 */
export function parseSonglistSearch(json) {
  const d = json?.data || {}
  const raw = Array.isArray(d.list) ? d.list : []
  const page = (Number(d.page_no) || 0) + 1
  const perPage = Number(d.num_per_page) || raw.length || 0
  const total = Number(d.display_num) || 0
  return {
    list: raw.map(mapSearchPlaylist).filter((p) => p.id),
    total,
    page,
    hasMore: raw.length > 0 && perPage > 0 && page * perPage < total,
  }
}

/**
 * 从单曲结果聚合歌手（按 mid / 歌名去重，累计出现次数）。
 * 歌手头像用官方 T001 写真地址；没有 mid 时不伪造地址，交给 AppImage 回退占位。
 */
export function aggregateSingers(songs) {
  const seen = new Map()
  for (const song of songs || []) {
    const refs = song.singerRefs || (song.singers || []).map((name) => ({ name, mid: '' }))
    for (const ref of refs) {
      if (!ref?.name) continue
      const key = ref.mid || ref.name
      if (!seen.has(key)) seen.set(key, { name: ref.name, mid: ref.mid || '', songCount: 0 })
      seen.get(key).songCount += 1
    }
  }
  return [...seen.values()].map((s) => ({
    id: s.mid || s.name,
    mid: s.mid,
    name: s.name,
    cover: s.mid ? `https://y.gtimg.cn/music/photo_new/T001R300x300M000${s.mid}.jpg` : '',
    songCount: s.songCount,
  }))
}

/** GET 文本（歌单搜索返回 JSONP，不能直接 res.json()） */
async function requestText(path, params, cookie, timeout = 15000) {
  const res = await httpRequest(`/qq-api${path}?${qs(params)}`, {
    headers: cookie ? { 'X-QQ-Cookie': cookie } : undefined,
    timeout,
    label: 'QQ音乐接口',
  })
  if (!res.ok) throw new Error(`QQ音乐接口请求失败 (${res.status})`)
  return res.text()
}

/**
 * 搜索（page 从 1 开始）。
 * @param {string} keyword
 * @param {'song'|'album'|'playlist'|'singer'} tab
 * @param {{ page?: number, pageSize?: number, cookie?: string }} opts
 */
export async function searchByType(keyword, tab = 'song', { page = 1, pageSize = 20, cookie } = {}) {
  const kw = String(keyword || '').trim()
  if (!kw) return { list: [], total: 0, page, hasMore: false }

  if (tab === 'playlist') {
    const text = await requestText(
      SONGLIST_SEARCH,
      { remoteplace: 'txt.yqq.playlist', page_no: Math.max(0, page - 1), num_per_page: pageSize, query: kw },
      cookie
    )
    return parseSonglistSearch(stripJsonp(text))
  }

  const t = tab === 'album' ? SEARCH_TYPES.album : SEARCH_TYPES.song
  const json = await qqGet(
    LEGACY_SEARCH,
    {
      w: kw,
      p: page,
      n: pageSize,
      t,
      format: 'json',
      inCharset: 'utf8',
      outCharset: 'utf-8',
      notice: 0,
      platform: 'yqq.json',
      needNewCode: 0,
      g_tk: 5381,
    },
    cookie
  )

  if (tab === 'singer') {
    const songs = parseSongSearch(json, 'song')
    const list = aggregateSingers(songs.list)
    return { list, total: list.length, page: 1, hasMore: false }
  }
  return parseSongSearch(json, tab)
}

// ---------------------------------------------------------------------------
// 热搜榜（C2）
// ---------------------------------------------------------------------------

/** musicu 热词模块（gethotkey.fcg 已被 WAF 拦截 500） */
export const HOTKEY_MODULE = 'music.musicsearch.HotkeyService'
export const HOTKEY_METHOD = 'GetHotkeyForQQMusicMobile'

/**
 * 解析 musicu 热词响应（纯函数）。
 * 字段：`vec_hotkey[].title`（= query，展示词）、`description`（如「正在热搜」）、`cover_pic_url`。
 * @param {{ vec_hotkey?: Array }} data `req_0.data`
 * @param {number} limit 最多返回条数（去重后）
 */
export function parseHotKeys(data, limit = 12) {
  const raw = Array.isArray(data?.vec_hotkey) ? data.vec_hotkey : []
  const list = raw
    .map((x) => ({
      keyword: String(x?.title || x?.query || '').trim(),
      description: String(x?.description || '').trim(),
      cover: httpsify(x?.cover_pic_url),
    }))
    .filter((x) => x.keyword)
  const seen = new Set()
  const out = []
  for (const k of list) {
    if (seen.has(k.keyword)) continue
    seen.add(k.keyword)
    out.push(k)
    if (out.length >= limit) break
  }
  return out
}

/** 热搜词（匿名可用；失败由调用方静默处理，不影响搜索主流程） */
export async function fetchHotKeys({ cookie, uin, limit = 12, timeout = 15000 } = {}) {
  const data = await musicuCall(HOTKEY_MODULE, HOTKEY_METHOD, { search_id: '0' }, { cookie, uin, timeout })
  return parseHotKeys(data, limit)
}

// ---------------------------------------------------------------------------
// 输入联想（C2）
// ---------------------------------------------------------------------------

/**
 * 解析 smartbox 联想响应（纯函数）：按 单曲 → 歌手 → 专辑 → MV 排序后截断。
 * @param {{ song?: object, singer?: object, album?: object, mv?: object }} data `data` 节点
 * @param {number} limit
 */
export function parseSuggestions(data, limit = 8) {
  if (limit <= 0) return []
  const pick = (node, type) =>
    (Array.isArray(node?.itemlist) ? node.itemlist : []).map((x) => ({
      type,
      name: String(x?.name || '').trim(),
      sub: String(x?.singer || '').trim(),
      mid: x?.mid || '',
      id: String(x?.id || ''),
    }))
  return [
    ...pick(data?.song, 'song'),
    ...pick(data?.singer, 'singer'),
    ...pick(data?.album, 'album'),
    ...pick(data?.mv, 'mv'),
  ]
    .filter((x) => x.name)
    .slice(0, limit)
}

/** 输入联想（空关键词不发请求） */
export async function fetchSuggest(keyword, { cookie, limit = 8, timeout = 10000 } = {}) {
  const kw = String(keyword || '').trim()
  if (!kw) return []
  const json = await qqGet(SMARTBOX, { key: kw, g_tk: 5381 }, cookie, timeout)
  return parseSuggestions(json?.data, limit)
}
