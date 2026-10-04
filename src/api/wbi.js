import md5 from 'blueimp-md5'
import { httpRequest } from '../core/http.js'

const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
  33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40,
  61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11,
  36, 20, 34, 44, 52,
]

let keyCache = null
const KEY_TTL = 6 * 60 * 60 * 1000

function mixinKey(orig) {
  return MIXIN_KEY_ENC_TAB.map((i) => orig[i])
    .join('')
    .slice(0, 32)
}

async function loadKeys() {
  if (keyCache && Date.now() - keyCache.time < KEY_TTL) return keyCache
  const res = await httpRequest('/bili-api/x/web-interface/nav', { label: 'B 站' })
  if (!res.ok) throw new Error(`获取 B 站 wbi 密钥失败 (${res.status})`)
  const json = await res.json()
  const img = json?.data?.wbi_img?.img_url || ''
  const sub = json?.data?.wbi_img?.sub_url || ''
  const imgKey = img.split('/').pop().split('.')[0]
  const subKey = sub.split('/').pop().split('.')[0]
  if (!imgKey || !subKey) throw new Error('解析 B 站 wbi 密钥失败')
  keyCache = { imgKey, subKey, time: Date.now() }
  return keyCache
}

/** 对参数进行 wbi 签名，返回可直接拼接的 query string */
export async function signWbi(params) {
  const { imgKey, subKey } = await loadKeys()
  const mixin = mixinKey(imgKey + subKey)
  const wts = Math.round(Date.now() / 1000)
  const all = { ...params, wts }
  const query = Object.keys(all)
    .sort()
    .map((k) => {
      const v = String(all[k]).replace(/[!'()*]/g, '')
      return `${encodeURIComponent(k)}=${encodeURIComponent(v)}`
    })
    .join('&')
  const wRid = md5(query + mixin)
  return `${query}&w_rid=${wRid}`
}
