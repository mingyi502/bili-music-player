/**
 * 评论写操作（P5 E2）。
 *
 * 读路径沿用歌曲详情的旧 CGI（`songDetail.js`），这里只负责写：
 * 经签名网关 `music.globalComment.CommentWriteServer/AddComment | DelComment`
 * （2026-09-26 探测：该模块在签名网关可达，非 500003；与 P4 写操作同一通道）。
 */
import { writeCall } from './write.js'

export const COMMENT_WRITE_MODULE = 'music.globalComment.CommentWriteServer'
export const COMMENT_MAX_LEN = 140

/** 发评论/回复的参数（纯函数，便于单测） */
export function buildAddCommentParam(songid, content, replyCmtId = '') {
  const id = Number(songid) || 0
  if (!id) throw new Error('缺少歌曲数字 ID，无法发表评论')
  const text = String(content || '').trim()
  if (!text) throw new Error('评论内容不能为空')
  if (text.length > COMMENT_MAX_LEN) throw new Error(`评论最多 ${COMMENT_MAX_LEN} 字`)
  const param = { Content: text, BizType: 1, BizId: String(id) }
  if (replyCmtId) param.RepliedCmId = String(replyCmtId)
  return param
}

/** 删除评论的参数（纯函数，便于单测） */
export function buildDeleteCommentParam(commentId) {
  const id = String(commentId || '').trim()
  if (!id) throw new Error('缺少评论 ID，无法删除')
  return { CommentId: id }
}

/** 发表评论（`replyCmtId` 非空时为回复） */
export async function addComment(songid, content, { replyCmtId = '', cookie, uin, label } = {}) {
  const param = buildAddCommentParam(songid, content, replyCmtId)
  return writeCall(COMMENT_WRITE_MODULE, 'AddComment', param, {
    cookie,
    uin,
    label: label || (replyCmtId ? '回复评论' : '发表评论'),
  })
}

/** 删除自己的评论 */
export async function deleteComment(commentId, { cookie, uin, label } = {}) {
  const param = buildDeleteCommentParam(commentId)
  return writeCall(COMMENT_WRITE_MODULE, 'DelComment', param, {
    cookie,
    uin,
    label: label || '删除评论',
  })
}
