/**
 * musicu 网关统一封装（u.y.qq.com/cgi-bin/musicu.fcg）。
 *
 * 所有 QQ 音乐接口（读 / 写）都走这里：
 * - `buildComm`     读请求的 comm 字段
 * - `buildWriteComm` 写请求的 comm（带 g_tk 签名，由 qm_keyst 计算）
 * - `musicuCall`    一次调用（构造 → 发送 → 取业务节点 → 抛错）
 *
 * 注意：postMusicu 内部会 JSON.stringify，调用处不要再序列化一次（否则 body 二次编码）。
 */
import { httpRequest } from '../../core/http.js'
import { getGtk } from '../../core/qqLogin.js'

export const MUSICU_PATH = '/qqmu-api/cgi-bin/musicu.fcg'

/** 从 Cookie 取音乐票据（写操作签名用） */
export function getMusicKey(cookie) {
  const m = String(cookie || '').match(/(?:^|;\s*)(?:qm_keyst|qqmusic_key)=([^;]+)/i)
  return m ? m[1].trim() : ''
}

/** 读请求的 comm 字段 */
export function buildComm({ uin = '0' } = {}) {
  return { ct: 24, cv: 0, uin: String(uin || '0'), format: 'json' }
}

/**
 * 写请求的 comm 字段（g_tk 签名）。
 * 受限会话没有 qm_keyst，写操作一定失败 —— 提前抛出可读错误。
 */
export function buildWriteComm({ uin = '0', cookie = '' } = {}) {
  const key = getMusicKey(cookie)
  if (!key) {
    throw new Error('缺少音乐票据（qm_keyst），无法执行写操作：请重新登录，或用「网页登录 / 手动 Cookie」方式登录')
  }
  return { ct: 24, cv: 0, uin: String(uin || '0'), format: 'json', platform: 'yqq', g_tk: getGtk(key) }
}

/** POST musicu.fcg（带超时，避免请求挂死拖住界面） */
export async function postMusicu(payload, cookie, timeout = 15000) {
  const res = await httpRequest(MUSICU_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-QQ-Cookie': cookie || '' },
    body: JSON.stringify(payload),
    timeout,
    label: '接口',
  })
  if (!res.ok) throw new Error(`接口请求失败 (${res.status})`)
  return res.json()
}

/** 取 musicu 响应里的业务节点（兼容 req_0 / req） */
export function musicuNode(data, key = 'req_0') {
  return data?.[key] || data?.req || {}
}

/** musicu 业务码文案（社区实测：1000 = 未登录） */
const MUSICU_MESSAGES = {
  1000: '未登录或登录已失效，请重新登录',
}

/** 把业务节点 / 网关层的错误码转成可读 Error；无错误返回 null */
export function musicuError(node, label = '接口') {
  const code = node?.code
  if (code === undefined || code === null || code === 0) return null
  const detail = `${label}返回 code=${code}${node.subcode ? `/${node.subcode}` : ''}${node.msg ? ` ${node.msg}` : ''}`
  const known = MUSICU_MESSAGES[code]
  return new Error(known ? `${known}（${detail}）` : detail)
}

/**
 * 一次 musicu 调用：构造 payload → 发送 → 校验网关与业务错误 → 返回业务 data。
 * @param {string} module 如 'music.musicasset.PlaylistDetailWrite'
 * @param {string} method 如 'AddSonglist'
 * @param {object} param  业务参数
 * @param {{ uin?: string, cookie?: string, timeout?: number, signed?: boolean, key?: string }} opts
 *        signed=true 时使用 buildWriteComm（写操作必须）
 */
export async function musicuCall(module, method, param, { uin, cookie, timeout = 15000, signed = false, key = 'req_0' } = {}) {
  const comm = signed ? buildWriteComm({ uin, cookie }) : buildComm({ uin })
  const payload = { comm, [key]: { module, method, param } }
  const data = await postMusicu(payload, cookie, timeout)
  const gatewayErr = musicuError({ code: data?.code, msg: data?.message }, '网关')
  if (gatewayErr) throw gatewayErr
  const node = musicuNode(data, key)
  const err = musicuError(node, method)
  if (err) throw err
  return node.data ?? node
}
