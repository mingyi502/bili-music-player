/**
 * 评论写操作 store（P5 E2）：票据守卫 + 统一错误提示 + 结果返回。
 *
 * 评论列表本身由 `SongDetailView` 局部持有；这里只包一层写守卫与 toast，
 * 发表/删除成功后由视图刷新自己的列表。
 */
import { state } from './state.js'
import { toast } from './ui.js'
import { ensureWritable, toastWriteError } from './write.js'
import { addComment as apiAddComment, deleteComment as apiDeleteComment } from '../api/qq/comment.js'

/** 发表评论（`replyCmtId` 非空时为回复）；成功返回业务数据，失败返回 null */
export async function postComment(songid, content, replyCmtId = '') {
  if (!ensureWritable()) return null
  try {
    const res = await apiAddComment(songid, content, {
      replyCmtId,
      cookie: state.config.qqCookie,
      uin: state.config.uin,
    })
    toast(replyCmtId ? '回复已发表' : '评论已发表', 'success')
    return res
  } catch (e) {
    toastWriteError(e)
    return null
  }
}

/** 删除自己的评论；成功返回 true */
export async function removeComment(commentId) {
  if (!ensureWritable()) return false
  try {
    await apiDeleteComment(commentId, { cookie: state.config.qqCookie, uin: state.config.uin })
    toast('评论已删除', 'success')
    return true
  } catch (e) {
    toastWriteError(e)
    return false
  }
}

/** 是否本人评论（旧 CGI 的 uin/encrypt_uin 可能是明文 uin 或加密 uin） */
export function isOwnComment(c) {
  const u = String(c?.uin || '')
  if (!u) return false
  return u === String(state.config.uin || '') || (state.config.euin && u === String(state.config.euin))
}
