/**
 * 每日推荐（雷达推荐）。
 *
 * 实测（2026-09）：QQ 没有与网易云「每日 30 首」完全对应的单一接口：
 * - `music.radioProxy.MbTrackRadioSvr/get_radio_track`（猜你喜欢）匿名出歌少、且多为助眠白噪音；
 * - `music.recommend.TrackRelationServer/GetRadarSong`（雷达）匿名可用、每页 10 首真歌、
 *   带 `HasMore` 翻页 —— 更适合做「每日推荐」：循环取页并按 mid 跨页去重，凑满 30 首。
 * 登录后雷达按口味个性化（未登录也能用，只是推荐偏泛化）。
 */
import { musicuCall } from './comm.js'
import { mapSong } from './util.js'

export const RADAR_MODULE = 'music.recommend.TrackRelationServer'
export const RADAR_METHOD = 'GetRadarSong'
export const DAILY_COUNT = 30

/** 雷达响应 → 歌曲数组（页内按 mid 去重，无效 Track 跳过） */
export function parseRadarSongs(data) {
  const vec = Array.isArray(data?.VecSongs) ? data.VecSongs : []
  const seen = new Set()
  const out = []
  for (const item of vec) {
    const track = item?.Track
    if (!track?.mid || seen.has(track.mid)) continue
    seen.add(track.mid)
    out.push(mapSong(track))
  }
  return out
}

/** 取雷达一页（page 从 1 起）；每日推荐与私人 FM 共用 */
export async function fetchRadarPage(page = 1, { cookie, uin, timeout = 15000 } = {}) {
  const data = await musicuCall(RADAR_MODULE, RADAR_METHOD, { Page: page }, { cookie, uin, timeout })
  return { songs: parseRadarSongs(data), hasMore: !!data?.HasMore }
}

/**
 * 每日推荐：循环雷达页凑满 count（跨页按 mid 去重）。
 * @param {{ cookie?: string, uin?: string, count?: number, maxPages?: number }} opts
 * @returns {{ songs: Array, pages: number, hasMore: boolean }}
 */
export async function fetchDailySongs({ cookie, uin, count = DAILY_COUNT, maxPages = 6, timeout = 15000 } = {}) {
  const seen = new Set()
  const songs = []
  let pages = 0
  let hasMore = false
  for (let page = 1; page <= maxPages; page++) {
    const res = await fetchRadarPage(page, { cookie, uin, timeout })
    pages = page
    hasMore = res.hasMore
    for (const song of res.songs) {
      if (seen.has(song.mid)) continue
      seen.add(song.mid)
      songs.push(song)
      if (songs.length >= count) break
    }
    if (songs.length >= count || !hasMore) break
  }
  return { songs: songs.slice(0, count), pages, hasMore }
}
