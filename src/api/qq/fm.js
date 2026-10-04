/**
 * 私人 FM。
 *
 * 实测（2026-09）：官方电台接口 `music.radioProxy.MbTrackRadioSvr/get_radio_track`
 * **匿名与登录态都只出 1~3 首/次，且默认落在「睡前」场景（助眠白噪音）**，不适合做 FM 音源；
 * 因此与「每日推荐」同源使用雷达 `music.recommend.TrackRelationServer/GetRadarSong`：
 * - 每页 10 首真歌、`HasMore` 可持续翻页
 * - FM 语义 = 连续补货 + 全程不重复（跨批次按 mid 排除）
 */
import { fetchRadarPage } from './daily.js'

export const FM_BATCH = 10
/** 单批最多翻几页（雷达页间可能有重复，翻页取「新歌」凑数） */
export const FM_MAX_PAGES = 3

/**
 * 取一批 FM 新歌（跳过 `exclude` 里的 mid，跨页去重）。
 * @param {{ startPage?: number, size?: number, exclude?: Iterable<string>, maxPages?: number, cookie?: string, uin?: string }} opts
 * @returns {{ songs: Array, nextPage: number, hasMore: boolean }}
 */
export async function fetchFmBatch({
  startPage = 1,
  size = FM_BATCH,
  exclude,
  maxPages = FM_MAX_PAGES,
  cookie,
  uin,
  timeout = 15000,
} = {}) {
  const skip = new Set(exclude || [])
  const songs = []
  let page = startPage
  let hasMore = false
  for (let i = 0; i < maxPages && songs.length < size; i++) {
    const res = await fetchRadarPage(page, { cookie, uin, timeout })
    hasMore = res.hasMore
    for (const song of res.songs) {
      if (skip.has(song.mid)) continue
      skip.add(song.mid)
      songs.push(song)
      if (songs.length >= size) break
    }
    page += 1
    if (!hasMore) break
  }
  return { songs, nextPage: page, hasMore }
}
