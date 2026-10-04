/**
 * QQ 音乐 `musics.fcg` 网关的 zzc 签名（P4.0 补充）。
 *
 * 背景：`u.y.qq.com/cgi-bin/musicu.fcg` 的**新增类写操作**被上游一律拒绝（业务码 80105），
 * 而签名网关 `u.y.qq.com/cgi-bin/musics.fcg?_=<ms>&sign=<sign>` 可正常写入（实测 AddSonglist
 * 成功并读回生效）。签名算法：SHA1(请求体) → 抽取索引字符 + 异或打散 → base64 去符号。
 *
 * 平台无关：使用 Web Crypto（浏览器 / Capacitor WebView 安全上下文 / Node 18+ 均可用）。
 */
const PART_1_INDEXES = [23, 14, 6, 36, 16, 7, 19]
const PART_2_INDEXES = [16, 1, 32, 12, 19, 27, 8, 5]
const SCRAMBLE_VALUES = [
  89, 39, 179, 150, 218, 82, 58, 252, 177, 52, 186, 123, 120, 64, 242, 133, 143, 161, 121, 179,
]

function toHexUpper(buffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase()
}

/**
 * 计算请求体签名。
 * @param {string} payload 将要发送的**原始请求体字符串**（必须与发送内容完全一致）
 * @returns {Promise<string>} `zzc` 前缀的小写签名
 */
export async function zzcSign(payload) {
  const bytes = new TextEncoder().encode(String(payload))
  const hashHex = toHexUpper(await crypto.subtle.digest('SHA-1', bytes))
  const part1 = PART_1_INDEXES.map((i) => hashHex[i]).join('')
  const part2 = PART_2_INDEXES.map((i) => hashHex[i]).join('')
  const part3 = new Uint8Array(20)
  for (let i = 0; i < 20; i++) {
    part3[i] = SCRAMBLE_VALUES[i] ^ parseInt(hashHex.substring(i * 2, i * 2 + 2), 16)
  }
  const b64 = btoa(String.fromCharCode(...part3)).replace(/[\\/+=]/g, '')
  return `zzc${part1}${b64}${part2}`.toLowerCase()
}
