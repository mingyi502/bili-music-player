/**
 * 写操作基础设施（P4.0）。
 *
 * 所有会改变账号数据的调用都走这里：
 * - 必须带音乐票据（`qm_keyst` / `qqmusic_key`）：comm 由 `buildWriteComm` 计算 `g_tk`，
 *   缺票据时在**发请求前**就抛出可读错误（受限会话无法写）
 * - **走签名网关** `musics.fcg?_=<ms>&sign=<zzc签名>`：实测 `musicu.fcg` 的新增类写操作
 *   被上游一律拒绝（80105），签名网关可正常写入（AddSonglist 成功并读回生效）
 * - 错误统一映射：网关 code / 业务 code / `data.retCode` → 可读文案（未知码保留原始码）
 *
 * ⚠️ 约定（见 ROADMAP 原则）：写操作不进自动化测试；测试只 mock 传输层，绝不发真实写请求。
 */
import { buildWriteComm, musicuNode } from './comm.js'
import { httpRequest } from '../../core/http.js'
import { zzcSign } from '../../core/zzcSign.js'

/** 签名网关（与读接口同域，走 `/qqmu-api` 代理；Web 端由 Vite 代理转发） */
export const SIGNED_PATH = '/qqmu-api/cgi-bin/musics.fcg'

/** 当前 Cookie 是否具备写操作票据 */
export function canWrite(cookie) {
  return /(?:^|;\s*)(?:qm_keyst|qqmusic_key)=/.test(String(cookie || ''))
}

/** 歌曲 → 写接口条目（数字 songId + songType，缺省 13 = QQ 常规歌曲） */
export function songWriteInfo(song) {
  const songId = Number(song?.id) || 0
  if (!songId) throw new Error('缺少歌曲数字 ID，无法执行写操作')
  return { songId, songType: Number(song?.songType) || 13 }
}

/** 写操作错误码文案（实测到新码时补充；未知码保留原始码） */
export const WRITE_MESSAGES = {
  1000: '未登录或登录已失效，请重新登录',
  1001: '登录态无效，请重新登录',
  2001: '操作过于频繁，请稍后再试',
  80105: '上游拒绝了本次写操作（可能受账号或通道限制）',
}

/**
 * 写操作错误 → 可读 Error；无错误返回 null。
 * 依次检查：业务节点 code、`data.retCode`、`data.result.retCode`。
 * @param {object|null} node musicu 业务节点（req_0）
 * @param {object|null} data 业务数据（node.data）
 * @param {string} label
 */
export function writeError(node, data, label = '写操作') {
  const code = node?.code
  const retCode = data?.retCode ?? data?.result?.retCode
  const badCode = code !== undefined && code !== null && code !== 0
  const badRet = retCode !== undefined && retCode !== null && retCode !== 0
  if (!badCode && !badRet) return null
  const shown = badCode ? code : retCode
  const msg = node?.msg || data?.msg || data?.result?.msg || ''
  const detail = `${label}返回 code=${shown}${node?.subcode ? `/${node.subcode}` : ''}${msg ? ` ${msg}` : ''}`
  const known = WRITE_MESSAGES[shown]
  return new Error(known ? `${known}（${detail}）` : detail)
}

/**
 * 一次写调用：签名 comm → 签名网关 POST → 网关/业务/retCode 错误映射 → 返回业务数据。
 * @param {string} module 如 'music.musicasset.PlaylistDetailWrite'
 * @param {string} method 如 'AddSonglist'
 * @param {object} param 业务参数
 * @param {{ cookie?: string, uin?: string, timeout?: number, label?: string }} opts
 */
export async function writeCall(module, method, param, { cookie, uin, timeout = 15000, label } = {}) {
  const payload = { comm: buildWriteComm({ uin, cookie }), req_0: { module, method, param } }
  const body = JSON.stringify(payload)
  const sign = await zzcSign(body)
  const res = await httpRequest(`${SIGNED_PATH}?_=${Date.now()}&sign=${sign}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-QQ-Cookie': cookie || '' },
    body,
    timeout,
    label: '接口',
  })
  if (!res.ok) throw new Error(`接口请求失败 (${res.status})`)
  const raw = await res.json()
  const gatewayErr = writeError({ code: raw?.code, msg: raw?.message }, null, '网关')
  if (gatewayErr) throw gatewayErr
  const node = musicuNode(raw, 'req_0')
  const err = writeError(node, node?.data, label || method)
  if (err) throw err
  return node.data ?? node
}
