/**
 * 关注歌手（P5 E5 可行部分，只读）。
 *
 * 接口：musicu `music.concern.RelationList/GetFollowSingerList`（`{ HostUin: 加密uin, From, Size }`），
 * 实测可用（2026-09-26：Total 19、`List[].MID/Name/AvatarUrl`）。
 * 好友列表 `music.homepage.Friendship/GetFriendList` 实测 code 1001（不可用）；
 * 关注/取关的写方法不存在（D9 负结论）→ 这里只做只读列表。
 */
import { musicuCall } from './comm.js'
import { httpsify } from './util.js'

export const FOLLOW_MODULE = 'music.concern.RelationList'

/** 关注歌手响应 → 歌手数组（`List[].MID/Name/AvatarUrl`） */
export function parseFollowedSingers(data) {
  const list = Array.isArray(data?.List) ? data.List : []
  return list
    .map((s) => ({
      mid: String(s?.MID || ''),
      name: String(s?.Name || '').trim(),
      avatar: httpsify(s?.AvatarUrl) || (s?.MID ? `https://y.gtimg.cn/music/photo_new/T001R300x300M000${s.MID}.jpg` : ''),
    }))
    .filter((s) => s.mid && s.name)
}

/**
 * 拉取关注歌手。
 * @param {{ euin?: string, uin?: string, cookie?: string, offset?: number, size?: number, timeout?: number }} opts
 */
export async function fetchFollowedSingers({ euin, uin, cookie, offset = 0, size = 20, timeout = 15000 } = {}) {
  const host = String(euin || uin || '').trim()
  if (!host) throw new Error('缺少账号标识，无法获取关注歌手')
  const data = await musicuCall(
    FOLLOW_MODULE,
    'GetFollowSingerList',
    { HostUin: host, From: Number(offset) || 0, Size: Number(size) || 20 },
    { cookie, uin, timeout }
  )
  return { total: Number(data?.Total) || 0, list: parseFollowedSingers(data) }
}
