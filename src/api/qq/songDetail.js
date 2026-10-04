/**
 * 歌曲详情：相似歌曲 + 评论。
 *
 * 接口（2026-09 实测可用）：
 * - 相似歌曲：musicu `music.recommend.TrackRelationServer/GetSimilarSongs`，**参数是数字 songid**，
 *   响应 `data.vecSong[].track`（嵌套一层）与歌曲模型同构。
 * - 评论：`c.y.qq.com/base/fcgi-bin/fcg_global_comment_h5.fcg`（GET），
 *   cid=205360772 / biztype=1 / topid=数字 songid / cmd=8（热评 + 最新）；
 *   `hot_comment.commentlist` + `comment.commentlist`，总数在 `comment.commenttotal`
 *   （部分响应在顶层 `CommentCount`）；分页用 `pagenum`（0 基）。
 */
import { httpRequest, qs } from '../../core/http.js'
import { mapSong, httpsify } from './util.js'
import { musicuCall } from './comm.js'

export const SIMILAR_MODULE = 'music.recommend.TrackRelationServer'
const COMMENT_PATH = '/base/fcgi-bin/fcg_global_comment_h5.fcg'

/** 相似歌曲响应 → 歌曲数组（`vecSong[].track`） */
export function parseSimilarSongs(data) {
  const vec = Array.isArray(data?.vecSong) ? data.vecSong : []
  return vec
    .map((v) => v?.track)
    .filter(Boolean)
    .map(mapSong)
}

/** 相似歌曲（songid 为数字 ID） */
export async function fetchSimilarSongs(songid, { limit = 12, cookie, uin, timeout = 15000 } = {}) {
  const id = Number(songid) || 0
  if (!id) throw new Error('缺少歌曲 ID，无法获取相似歌曲')
  const data = await musicuCall(SIMILAR_MODULE, 'GetSimilarSongs', { songid: id }, { cookie, uin, timeout })
  return parseSimilarSongs(data).slice(0, limit)
}

/** 评论内容清理：去掉 [em]xxx[/em] 表情码、压缩空白 */
export function cleanCommentContent(text) {
  return String(text || '')
    .replace(/\[em\].*?\[\/em\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 评论响应 → `{ hot, list, total }`（带 uin/euin 便于识别自己的评论） */
export function parseComments(json, { hotLimit = 5 } = {}) {
  const map = (c) => ({
    id: String(c?.commentid || ''),
    nick: c?.nick || 'QQ音乐用户',
    avatar: httpsify(c?.avatarurl),
    content: cleanCommentContent(c?.rootcommentcontent),
    praise: Number(c?.praisenum) || 0,
    hot: !!(c?.is_hot || c?.is_hot_cmt),
    time: Number(c?.time) || 0,
    uin: String(c?.uin || c?.encrypt_uin || ''),
  })
  const hot = (json?.hot_comment?.commentlist || []).map(map).filter((c) => c.content).slice(0, hotLimit)
  const list = (json?.comment?.commentlist || []).map(map).filter((c) => c.content)
  const total = Number(json?.CommentCount ?? json?.comment?.commenttotal) || 0
  return { hot, list, total }
}

/** 评论（pagenum 从 0 起） */
export async function fetchComments(topid, { page = 0, pageSize = 20, hotLimit = 5, cookie, timeout = 15000 } = {}) {
  const id = Number(topid) || 0
  if (!id) throw new Error('缺少歌曲 ID，无法获取评论')
  const query = qs({
    g_tk: 5381,
    loginUin: 0,
    hostUin: 0,
    format: 'json',
    inCharset: 'utf8',
    outCharset: 'utf-8',
    notice: 0,
    platform: 'yqq.json',
    needNewCode: 0,
    cid: 205360772,
    reqtype: 2,
    biztype: 1,
    topid: id,
    cmd: 8,
    needmusiccrit: 0,
    pagenum: page,
    pagesize: pageSize,
  })
  const res = await httpRequest(`/qq-api${COMMENT_PATH}?${query}`, {
    headers: cookie ? { 'X-QQ-Cookie': cookie } : undefined,
    timeout,
    label: 'QQ音乐接口',
  })
  if (!res.ok) throw new Error(`QQ音乐接口请求失败 (${res.status})`)
  return parseComments(await res.json(), { hotLimit })
}
