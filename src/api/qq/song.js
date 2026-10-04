/** 歌曲直链（vkey）与歌曲信息。 */
import { postMusicu, buildComm, musicuCall } from './comm.js'

/**
 * 解析 vkey 响应（纯函数，便于单测）→ `{ url, restriction, result, filename, trial }`
 * - `url` 非空即可播
 * - `restriction`：`''` 可播 / `vip_required`（需登录或会员，result=104003）/
 *   `url_unavailable`（其它错误码）/ `copyright_unavailable`（purl 为空，无版权或需付费）
 */
export function parseSongUrlInfo(req) {
  const info = req?.data?.midurlinfo?.[0] || {}
  const purl = info.purl || ''
  const result = Number(info.result) || 0
  const sip = (req?.data?.sip || [])[0] || 'https://dl.stream.qqmusic.qq.com/'
  const url = purl ? String(sip).replace(/^http:/, 'https:') + purl : ''
  let restriction = ''
  if (!url) {
    if (result === 104003) restriction = 'vip_required'
    else if (result !== 0) restriction = 'url_unavailable'
    else restriction = 'copyright_unavailable'
  }
  return {
    url,
    restriction,
    result,
    filename: info.filename || '',
    trial: /RS02|try/i.test(info.filename || ''),
  }
}

/** 获取歌曲直链信息（含受限原因） */
export async function fetchSongUrlInfo(songMid, uin, cookie) {
  if (!songMid) return { url: '', restriction: 'copyright_unavailable', result: 0, filename: '', trial: false }
  const guid = String(Math.floor(1000000000 + Math.random() * 9000000000))
  const payload = {
    comm: buildComm({ uin }),
    req_0: {
      module: 'vkey.GetVkeyServer',
      method: 'CgiGetVkey',
      param: { guid, songmid: [songMid], songtype: [0], uin: String(uin || '0'), loginflag: 1, platform: '20' },
    },
  }
  let data
  try {
    data = await postMusicu(payload, cookie, 12000)
  } catch {
    return { url: '', restriction: 'url_unavailable', result: 0, filename: '', trial: false }
  }
  const req = data.req_0 || data.req || {}
  if (req.code !== 0) return { url: '', restriction: 'url_unavailable', result: Number(req.code) || 0, filename: '', trial: false }
  return parseSongUrlInfo(req)
}

/** 获取歌曲播放直链（vkey），拿不到返回 ''（保持旧契约） */
export async function fetchSongUrl(songMid, uin, cookie) {
  return (await fetchSongUrlInfo(songMid, uin, cookie)).url
}

// ---------------------------------------------------------------------------
// 按 mid 批量取歌曲信息（G5 导入用：写歌单需要数字 songId）
// ---------------------------------------------------------------------------
export const TRACK_INFO_MODULE = 'music.trackInfo.UniformRuleCtrl'
export const TRACK_INFO_METHOD = 'CgiGetTrackInfo'

/** 解析 track info 响应 → `[{ mid, id, name, singers, album, interval, songType }]` */
export function parseTracks(data) {
  return (data?.tracks || []).map((t) => ({
    mid: t.mid || '',
    id: Number(t.id) || 0,
    name: t.name || '',
    singers: (t.singer || []).map((s) => s.name).filter(Boolean),
    album: t.album?.name || '',
    interval: Number(t.interval) || 0,
    songType: Number(t.type) || 0,
  }))
}

/** 按 mid 批量取歌曲信息（含数字 songId）；每批 ≤50，单批失败不阻断 */
export async function fetchTracksByMids(mids, { cookie, uin, batch = 50, timeout = 15000 } = {}) {
  const list = (mids || []).filter(Boolean)
  const out = []
  for (let i = 0; i < list.length; i += batch) {
    const part = list.slice(i, i + batch)
    const data = await musicuCall(
      TRACK_INFO_MODULE,
      TRACK_INFO_METHOD,
      { mids: part, types: part.map(() => 0) },
      { cookie, uin, timeout }
    )
    out.push(...parseTracks(data))
  }
  return out
}
