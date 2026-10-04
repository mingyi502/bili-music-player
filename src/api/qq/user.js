/** 用户相关：歌单列表、资料、收藏歌单、加密 uin。 */
import { request, mapCover, httpsify, isLikedDir } from './util.js'

/** 获取某 QQ 号创建/收藏的公开歌单；传入 cookie 可获取私密歌单 */
export async function fetchUserPlaylists(uin, cookie) {
  if (!/^\d+$/.test(String(uin || '').trim())) {
    throw new Error('请输入正确的 QQ 号')
  }
  const data = await request(
    '/rsc/fcgi-bin/fcg_user_created_diss',
    {
      hostuin: String(uin).trim(),
      size: 200,
      handlet: 2,
      format: 'json',
      inCharset: 'utf8',
      outCharset: 'utf-8',
      notice: 0,
      platform: 'yqq.json',
      needNewCode: 1,
    },
    cookie
  )
  if (data.code !== 0) throw new Error(data.message || '获取用户歌单失败')
  const raw = data.data?.disslist || []
  // 注意：不要用 dir_show 过滤，私密歌单的 dir_show 为 0，会被误删；
  // QZone 背景音乐那条的 tid 为 0，用它过滤即可。
  // 「我喜欢」(dirid/tid=201) 也要排除：侧栏「我的音乐」已单独展示，混在创建列表里会重复。
  return raw
    .filter((d) => d.tid && String(d.tid) !== '0')
    .filter((d) => !isLikedDir(d))
    .map((d) => ({
      id: String(d.tid),
      name: d.diss_name || '未命名歌单',
      cover: mapCover(d.diss_cover, 300),
      songCount: d.song_cnt || 0,
      listenNum: d.listen_num || 0,
      dirId: d.dirid,
      kind: 'created',
    }))
}

/** 原始返回，供诊断使用（不过滤，便于看出被过滤掉多少） */
export async function fetchUserPlaylistsRaw(uin, cookie) {
  const data = await request(
    '/rsc/fcgi-bin/fcg_user_created_diss',
    {
      hostuin: String(uin).trim(),
      size: 200,
      handlet: 2,
      format: 'json',
      inCharset: 'utf8',
      outCharset: 'utf-8',
      notice: 0,
      platform: 'yqq.json',
      needNewCode: 1,
    },
    cookie
  )
  const raw = data.data?.disslist || []
  return {
    code: data.code,
    total: raw.length,
    withTid: raw.filter((d) => d.tid && String(d.tid) !== '0').length,
    // 被「我喜欢」规则排除掉的条数，供诊断解释「原始 N 条 / 实际 N 个」的差异
    likedExcluded: raw.filter(isLikedDir).length,
    sample: raw.slice(0, 3).map((d) => ({ name: d.diss_name, tid: d.tid, dirid: d.dirid, dirShow: d.dir_show, songCnt: d.song_cnt })),
  }
}

/** 获取当前登录用户资料（昵称/头像/会员） */
export async function fetchUserInfo(uin, cookie) {
  const data = await request(
    '/rsc/fcgi-bin/fcg_get_profile_homepage.fcg',
    {
      ct: 20,
      cid: 205360838,
      userid: uin,
      reqfrom: 1,
      reqtype: 0,
      g_tk: 5381,
      loginUin: uin,
      hostUin: 0,
      format: 'json',
      inCharset: 'utf8',
      outCharset: 'utf-8',
      notice: 0,
      platform: 'yqq.json',
      needNewCode: 0,
    },
    cookie
  )
  if (data.code !== 0) {
    throw new Error(`资料接口返回 code=${data.code}${data.msg ? ` (${data.msg})` : ''}`)
  }
  const c = data.data?.creator || data.data || {}
  return {
    uin: String(c.hostuin || c.uin || uin),
    nickname: c.nick || c.nickname || '',
    // 服务端可能返回 http://thirdqq.qlogo.cn/...，Android 默认禁止明文流量会加载失败
    avatar: httpsify(c.headpic || c.headurl || ''),
    vip: Number(c.vip || data.data?.vip?.viptype || 0) || 0,
  }
}

/** 获取用户收藏的歌单 */
export async function fetchCollectedPlaylists(uin, cookie) {
  const data = await request(
    '/fav/fcgi-bin/fcg_get_profile_order_asset.fcg',
    {
      ct: 20,
      cid: 205360956,
      userid: uin,
      reqfrom: 1,
      reqtype: 2,
      sin: 0,
      ein: 100,
      g_tk: 5381,
      loginUin: uin,
      hostUin: 0,
      format: 'json',
      inCharset: 'utf8',
      outCharset: 'utf-8',
      notice: 0,
      platform: 'yqq.json',
      needNewCode: 0,
    },
    cookie
  )
  if (data.code !== 0) throw new Error(data.msg || '获取收藏歌单失败')
  const raw = data.data?.cdlist || data.data?.disslist || data.data?.list || []
  return raw
    .map((d) => ({
      id: String(d.dissid || d.dirid || d.tid || ''),
      name: d.dissname || d.diss_name || '未命名歌单',
      cover: mapCover(d.logo || d.picurl || d.diss_cover, 300),
      songCount: d.songnum || d.song_cnt || 0,
      listenNum: d.listennum || d.listen_num || 0,
      kind: 'collected',
    }))
    .filter((d) => d.id)
}

/** 获取加密 uin（部分接口需要 enc_host_uin） */
export async function fetchEncryptUin(uin, cookie) {
  const data = await request(
    '/rsc/fcgi-bin/fcg_user_created_diss',
    {
      hostuin: String(uin).trim(),
      size: 1,
      handlet: 2,
      format: 'json',
      inCharset: 'utf8',
      outCharset: 'utf-8',
      notice: 0,
      platform: 'yqq.json',
      needNewCode: 1,
    },
    cookie
  )
  return data.data?.encrypt_uin || ''
}
