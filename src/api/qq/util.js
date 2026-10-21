/**
 * QQ 音乐接口公共工具：c.y.qq.com 系请求、字段映射、常量。
 * 平台无关，只依赖 core/http 适配层。
 */
import { httpRequest, qs } from '../../core/http.js'

const BASE = '/qq-api'

/** GET 请求 c.y.qq.com 系接口 */
export async function request(path, params, cookie, timeout = 15000) {
  const res = await httpRequest(`${BASE}${path}?${qs(params)}`, {
    headers: cookie ? { 'X-QQ-Cookie': cookie } : undefined,
    timeout,
    label: 'QQ音乐接口',
  })
  if (!res.ok) throw new Error(`QQ音乐接口请求失败 (${res.status})`)
  return res.json()
}

/** 从分享链接或纯数字中解析出歌单 id */
export function parsePlaylistId(input) {
  if (!input) return ''
  const text = String(input).trim()
  if (/^\d+$/.test(text)) return text
  const m =
    text.match(/playlist\/(\d+)/) ||
    text.match(/[?&]id=(\d+)/) ||
    text.match(/disstid=(\d+)/) ||
    text.match(/(\d{6,})/)
  return m ? m[1] : ''
}

/**
 * 从 Cookie 中解析 QQ 号。
 * 注意：登录 Cookie 里不一定有 `uin=`，受限会话可能只有 `p_uin` / `pt2gguin` /
 * `superuin`（形如 `o10000`，需去掉前缀 o）。
 */
export function parseUinFromCookie(cookie) {
  const m = String(cookie || '').match(
    /(?:^|;\s*)(?:uin|p_uin|pt2gguin|superuin|wxuin|qqmusic_uin|ptui_loginuin|loginuin)=(o?\d{5,})/i
  )
  return m ? m[1].replace(/^o/i, '') : ''
}

export function mapCover(url, size = 300) {
  if (!url) return ''
  return url.replace(/R\d+x\d+M000/, `R${size}x${size}M000`).replace(/^http:/, 'https:')
}

export function albumCover(albumMid, size = 300) {
  if (!albumMid) return ''
  return `https://y.gtimg.cn/music/photo_new/T002R${size}x${size}M000${albumMid}.jpg`
}

/**
 * 「我喜欢」的固定目录号。
 * 它既被取歌接口用作 dirid（见 fetchLikedSongs），也会混在「创建的歌单」里返回，
 * 而侧栏「我的音乐」已经单独展示了它 —— 所以要排除，避免出现两个「我喜欢」。
 */
export const LIKED_DIR_ID = '201'

/** 判断若干 id（原始条目的 dirid/tid，或映射后歌单的 dirId/id）里是否有「我喜欢」 */
export function isLikedDirId(...ids) {
  return ids.some((v) => v !== undefined && v !== null && String(v) === LIKED_DIR_ID)
}

/** 判断 `fcg_user_created_diss` 的原始条目是否为「我喜欢」 */
export function isLikedDir(d) {
  return isLikedDirId(d?.dirid, d?.tid)
}

export function mapSong(s) {
  const albumMid = s.album?.mid || s.albummid || ''
  const name = s.name || s.title || s.songname || ''
  const aliases = [...new Set(
    [s.title, s.subtitle, s.titleDetail, s.transname, s.nameTrans]
      .map((x) => String(x || '').trim())
      .filter((x) => x && x !== name)
  )]
  return {
    id: String(s.id || s.songid || ''),
    mid: s.mid || s.songmid || '',
    name,
    aliases,
    singers: (s.singer || []).map((x) => (typeof x === 'string' ? x : x.name)).filter(Boolean),
    album: s.album?.name || s.albumname || '',
    albumMid,
    cover: albumCover(albumMid, 150),
    interval: s.interval || 0,
    mvVid: s.mv?.vid || '',
    /** 写接口（收藏/加歌）需要的歌曲类型；QQ 常规歌曲为 13 */
    songType: Number(s.songtype ?? s.songType ?? s.type) || 0,
    /** 付费受限（G2）：payplay=1 为 VIP/付费歌曲（播放时优先回退 B 站） */
    payplay: Number(s.pay?.payplay) || 0,
    /** 是否有试听片段（purl 为空时可能仍可试听） */
    hasPreview: !!s.preview,
  }
}

export function mapAlbum(a) {
  const mid = a.mid || a.albummid || a.albumMid || ''
  const pmid = a.pmid || mid
  const singers = a.v_singer || a.singer || a.singers || []
  return {
    id: String(a.id || a.albumid || a.albumId || mid || ''),
    mid,
    pmid,
    name: a.name || a.albumname || a.albumName || '未知专辑',
    singers: (Array.isArray(singers) ? singers : [singers])
      .map((x) => (typeof x === 'string' ? x : x?.name))
      .filter(Boolean),
    cover: albumCover(mid, 300) || albumCover(pmid, 300),
    songCount: a.songnum || a.songNum || a.song_count || a.songcnt || 0,
    pubtime: a.pubtime || 0,
    ordertime: a.ordertime || 0,
  }
}

/** 用 QQ 号生成默认头像（资料接口不可用时的兜底） */
export function defaultAvatar(uin) {
  if (!uin) return ''
  return `https://q1.qlogo.cn/g?b=qq&nk=${uin}&s=100`
}

/** 把 http:// 升级为 https://（QQ 各图片域名均支持 https），避免 Android 明文流量限制 */
export function httpsify(url) {
  if (!url) return ''
  return String(url).startsWith('//') ? `https:${url}` : String(url).replace(/^http:\/\//i, 'https://')
}

/** HTML 实体解码（歌单名/标签名里有 `&#124;`、`R&#38;B` 之类） */
export function decodeEntities(text) {
  return String(text || '').replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos);/gi, (m, e) => {
    const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
    const key = String(e).toLowerCase()
    if (named[key]) return named[key]
    const code = key.startsWith('#x') ? parseInt(key.slice(2), 16) : parseInt(key.slice(1), 10)
    return Number.isFinite(code) ? String.fromCodePoint(code) : m
  })
}
