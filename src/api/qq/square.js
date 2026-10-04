/**
 * 歌单广场（C4）：分类配置 + 按分类取歌单。
 *
 * 接口（c.y.qq.com/splcloud/fcgi-bin/，与搜索同属经典 CGI）：
 * - `fcg_get_diss_tag_conf.fcg` 分类/排序配置（热门 / 语种 / 风格 / 场景 / 情感 / 主题）
 * - `fcg_get_diss_by_tag.fcg`   按分类取歌单；`sin`/`ein` 为**闭区间**下标（30 条 → 0..29）
 */
import { request as qqGet, httpsify, decodeEntities } from './util.js'

const TAG_CONF = '/splcloud/fcgi-bin/fcg_get_diss_tag_conf.fcg'
const DISS_BY_TAG = '/splcloud/fcgi-bin/fcg_get_diss_by_tag.fcg'

const COMMON = {
  format: 'json',
  inCharset: 'utf8',
  outCharset: 'utf-8',
  notice: 0,
  platform: 'yqq.json',
  needNewCode: 0,
  g_tk: 5381,
}

/** 「全部」分类（热门组） */
export const ALL_CATEGORY_ID = 10000000
/** 默认排序（最热） */
export const DEFAULT_SORT_ID = 5

/** 分类未提供排序项时的兜底（实测 allsorts 只给 2/3/4） */
export const FALLBACK_SORTS = [
  { id: 2, name: '最新' },
  { id: 3, name: '最热' },
  { id: 4, name: '评分' },
]

/**
 * 分类配置 → `[{ name, tags: [{ id, name, sorts: [{ id, name }] }] }]`
 * @param {{ categories?: Array }} data 响应 `data`
 */
export function parseTagGroups(data) {
  const groups = Array.isArray(data?.categories) ? data.categories : []
  return groups
    .map((g) => ({
      name: decodeEntities(g.categoryGroupName || '分类'),
      tags: (Array.isArray(g.items) ? g.items : [])
        .map((it) => ({
          id: Number(it.categoryId) || 0,
          name: decodeEntities(it.categoryName || ''),
          sorts: (Array.isArray(it.allsorts) ? it.allsorts : []).map((s) => ({
            id: Number(s.sortId) || 0,
            name: decodeEntities(s.sortName || ''),
          })),
        }))
        .filter((t) => t.id && t.name),
    }))
    .filter((g) => g.tags.length)
}

/**
 * 歌单列表 → `{ list, total, hasMore }`。
 * 条目字段：dissid / dissname / imgurl / listennum / creator.name。
 * @param {{ data?: object }} json 响应（含 data 壳）
 * @param {{ sin?: number }} opts
 */
export function parseSquareList(json, { sin = 0 } = {}) {
  const d = json?.data || {}
  const raw = Array.isArray(d.list) ? d.list : []
  const total = Number(d.sum) || 0
  const start = Number.isFinite(Number(d.sin)) ? Number(d.sin) : sin
  const end = Number.isFinite(Number(d.ein)) ? Number(d.ein) : start + raw.length - 1
  const list = raw
    .map((p) => ({
      id: String(p.dissid || ''),
      name: decodeEntities(p.dissname || '未命名歌单'),
      cover: httpsify(p.imgurl || ''),
      listenNum: Number(p.listennum) || 0,
      nick: decodeEntities(p.creator?.name || p.creator?.nick || ''),
      createTime: p.createtime || '',
      desc: p.introduction || '',
    }))
    .filter((p) => p.id)
  return { list, total, hasMore: raw.length > 0 && end + 1 < total }
}

/** 分类配置 */
export async function fetchSquareTags({ cookie, timeout = 15000 } = {}) {
  const json = await qqGet(TAG_CONF, { ...COMMON }, cookie, timeout)
  return parseTagGroups(json?.data)
}

/**
 * 按分类取歌单（page 从 1 起）。
 * @param {{ categoryId?: number, sortId?: number, page?: number, pageSize?: number, cookie?: string }} opts
 */
export async function fetchSquareList({
  categoryId = ALL_CATEGORY_ID,
  sortId = DEFAULT_SORT_ID,
  page = 1,
  pageSize = 30,
  cookie,
  timeout = 15000,
} = {}) {
  const sin = Math.max(0, (page - 1) * pageSize)
  const ein = sin + pageSize - 1
  const json = await qqGet(
    DISS_BY_TAG,
    { picmid: 1, rnd: Math.random(), loginUin: 0, hostUin: 0, categoryId, sortId, sin, ein, ...COMMON },
    cookie,
    timeout
  )
  return parseSquareList(json, { sin })
}
