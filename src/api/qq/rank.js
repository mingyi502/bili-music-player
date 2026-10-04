/**
 * QQ 音乐排行榜（musicToplist.ToplistInfoServer）。
 *
 * 实测（2026-09）：老接口 `fcg_v8_toplist_index.fcg` 已 404、`fcg_v8_toplist_cp.fcg` 返回空；
 * 改走 musicu 的 `musicToplist.ToplistInfoServer`：
 * - `GetAll`    榜单分组（巅峰榜 / 地区榜 / 特色榜 / 全球榜）与各榜单元信息
 * - `GetDetail` 榜单详情：`data.data` 为元信息 + `song[]`（排名条目），
 *               `data.songInfoList[i]` 为对应歌曲完整信息（含 mid），需要按下标合并
 *
 * 注意 `period`：首次传空字符串时上游会返回当前周期（如 `2026-09-24` / `2026_W39`），
 * 需要用返回的周期重试一次才能拿到 `song[]` 数据。
 */
import { musicuCall } from './comm.js'
import { mapSong, httpsify } from './util.js'

export const RANK_MODULE = 'musicToplist.ToplistInfoServer'

/** 榜单分组（GetAll）→ 内部结构 */
export function parseRankGroups(data) {
  const groups = Array.isArray(data?.group) ? data.group : []
  return groups
    .map((g) => ({
      name: g.groupName || '榜单',
      lists: (Array.isArray(g.toplist) ? g.toplist : []).map((t) => ({
        id: Number(t.topId) || 0,
        title: t.title || '',
        subtitle: t.titleDetail || t.titleSub || '',
        cover: httpsify(t.headPicUrl || t.frontPicUrl),
        updateTime: t.updateTime || '',
        period: t.period || '',
        listenNum: Number(t.listenNum) || 0,
        totalNum: Number(t.totalNum) || 0,
      })),
    }))
    .filter((g) => g.name && g.lists.length)
}

/**
 * 榜单详情（GetDetail）→ `{ info, list, hasMore }`。
 * 排名条目与歌曲信息按下标合并；`rankValue` 仅在有意义时保留（如飙升榜的 "15%"）。
 * @param {object} data `req_0.data`（含 `data` 与 `songInfoList`）
 * @param {{ offset?: number }} opts
 */
export function parseRankDetail(data, { offset = 0 } = {}) {
  const meta = data?.data || {}
  const entries = Array.isArray(meta.song) ? meta.song : []
  const infos = Array.isArray(data?.songInfoList) ? data.songInfoList : []
  const info = {
    id: Number(meta.topId) || 0,
    title: meta.title || '',
    subtitle: meta.titleDetail || '',
    intro: meta.intro || '',
    cover: httpsify(meta.headPicUrl || meta.frontPicUrl),
    updateTime: meta.updateTime || '',
    period: meta.period || '',
    listenNum: Number(meta.listenNum) || 0,
    total: Number(meta.totalNum) || 0,
  }
  const list = entries.map((entry, i) => {
    const song = mapSong({ ...entry, ...(infos[i] || {}) })
    const rank = Number(entry.rank) || offset + i + 1
    const rankValue = entry.rankValue && entry.rankValue !== '0' ? entry.rankValue : ''
    return { ...song, rank, rankValue }
  })
  return { info, list, hasMore: entries.length > 0 && offset + entries.length < info.total }
}

/** 榜单分组 */
export async function fetchRankList({ cookie, uin, timeout = 15000 } = {}) {
  const data = await musicuCall(RANK_MODULE, 'GetAll', {}, { cookie, uin, timeout })
  return parseRankGroups(data)
}

/**
 * 榜单详情（offset 从 0 起）。
 * 首次用空 period 探测当前周期，再用上游返回值重试一次。
 */
export async function fetchRankDetail(topId, { offset = 0, num = 50, period = '', cookie, uin, timeout = 15000 } = {}) {
  const params = { topId: Number(topId) || 0, offset, num, period }
  let data = await musicuCall(RANK_MODULE, 'GetDetail', params, { cookie, uin, timeout })
  const current = data?.data?.period
  if (current && current !== period) {
    data = await musicuCall(RANK_MODULE, 'GetDetail', { ...params, period: current }, { cookie, uin, timeout })
  }
  return parseRankDetail(data, { offset })
}
