/**
 * QQ 音乐 QRC 歌词解密（QQ 客户端使用的 "buggy DES" 变体 3DES + zlib）。
 *
 * 算法来源（MIT License，仅做等价 JavaScript 移植，未使用 GPL 实现）：
 * - WXRIW/QQMusicDecoder · QQMusicDecoder/DESHelper.cs + Decrypter.cs
 *   https://github.com/WXRIW/QQMusicDecoder （MIT, Copyright (c) 2023 WXRIW）
 * 参考背景：wangqr/QQMusicDES（MIT）对同一 "buggy DES" 的说明。
 *
 * 与标准 DES 的差异：密钥扩展（KeySchedule）按 QQ 客户端的实现（`& 0xfffffff0`），
 * 其余轮函数与标准 DES 一致；整段数据按 8 字节 ECB 分组，3 组密钥顺序为
 * key[0:8] → key[8:16]（解密）→ key[16:24]，解密后做 zlib inflate。
 */

const QQ_KEY_TEXT = '!@#)(*$%123ZXC!@!@#)(NHL'

export const DES_ENCRYPT = 1
export const DES_DECRYPT = 0

function bitNum(a, b, c) {
  const idx = Math.floor(b / 32) * 4 + 3 - Math.floor((b % 32) / 8)
  return (((a[idx] >> (7 - (b % 8))) & 1) << c) >>> 0
}

function bitNumIntr(a, b, c) {
  return (((a >>> (31 - b)) & 1) << c) >>> 0
}

function bitNumIntl(a, b, c) {
  return (((a << b) & 0x80000000) >>> c) >>> 0
}

function sboxBit(a) {
  return ((a & 0x20) | ((a & 0x1f) >>> 1) | ((a & 0x01) << 4)) >>> 0
}

const SBOX1 = [
  14, 4, 13, 1, 2, 15, 11, 8, 3, 10, 6, 12, 5, 9, 0, 7,
  0, 15, 7, 4, 14, 2, 13, 1, 10, 6, 12, 11, 9, 5, 3, 8,
  4, 1, 14, 8, 13, 6, 2, 11, 15, 12, 9, 7, 3, 10, 5, 0,
  15, 12, 8, 2, 4, 9, 1, 7, 5, 11, 3, 14, 10, 0, 6, 13,
]
const SBOX2 = [
  15, 1, 8, 14, 6, 11, 3, 4, 9, 7, 2, 13, 12, 0, 5, 10,
  3, 13, 4, 7, 15, 2, 8, 15, 12, 0, 1, 10, 6, 9, 11, 5,
  0, 14, 7, 11, 10, 4, 13, 1, 5, 8, 12, 6, 9, 3, 2, 15,
  13, 8, 10, 1, 3, 15, 4, 2, 11, 6, 7, 12, 0, 5, 14, 9,
]
const SBOX3 = [
  10, 0, 9, 14, 6, 3, 15, 5, 1, 13, 12, 7, 11, 4, 2, 8,
  13, 7, 0, 9, 3, 4, 6, 10, 2, 8, 5, 14, 12, 11, 15, 1,
  13, 6, 4, 9, 8, 15, 3, 0, 11, 1, 2, 12, 5, 10, 14, 7,
  1, 10, 13, 0, 6, 9, 8, 7, 4, 15, 14, 3, 11, 5, 2, 12,
]
const SBOX4 = [
  7, 13, 14, 3, 0, 6, 9, 10, 1, 2, 8, 5, 11, 12, 4, 15,
  13, 8, 11, 5, 6, 15, 0, 3, 4, 7, 2, 12, 1, 10, 14, 9,
  10, 6, 9, 0, 12, 11, 7, 13, 15, 1, 3, 14, 5, 2, 8, 4,
  3, 15, 0, 6, 10, 10, 13, 8, 9, 4, 5, 11, 12, 7, 2, 14,
]
const SBOX5 = [
  2, 12, 4, 1, 7, 10, 11, 6, 8, 5, 3, 15, 13, 0, 14, 9,
  14, 11, 2, 12, 4, 7, 13, 1, 5, 0, 15, 10, 3, 9, 8, 6,
  4, 2, 1, 11, 10, 13, 7, 8, 15, 9, 12, 5, 6, 3, 0, 14,
  11, 8, 12, 7, 1, 14, 2, 13, 6, 15, 0, 9, 10, 4, 5, 3,
]
const SBOX6 = [
  12, 1, 10, 15, 9, 2, 6, 8, 0, 13, 3, 4, 14, 7, 5, 11,
  10, 15, 4, 2, 7, 12, 9, 5, 6, 1, 13, 14, 0, 11, 3, 8,
  9, 14, 15, 5, 2, 8, 12, 3, 7, 0, 4, 10, 1, 13, 11, 6,
  4, 3, 2, 12, 9, 5, 15, 10, 11, 14, 1, 7, 6, 0, 8, 13,
]
const SBOX7 = [
  4, 11, 2, 14, 15, 0, 8, 13, 3, 12, 9, 7, 5, 10, 6, 1,
  13, 0, 11, 7, 4, 9, 1, 10, 14, 3, 5, 12, 2, 15, 8, 6,
  1, 4, 11, 13, 12, 3, 7, 14, 10, 15, 6, 8, 0, 5, 9, 2,
  6, 11, 13, 8, 1, 4, 10, 7, 9, 5, 0, 15, 14, 2, 3, 12,
]
const SBOX8 = [
  13, 2, 8, 4, 6, 15, 11, 1, 10, 9, 3, 14, 5, 0, 12, 7,
  1, 15, 13, 8, 10, 3, 7, 4, 12, 5, 6, 11, 0, 14, 9, 2,
  7, 11, 4, 1, 9, 12, 14, 2, 0, 6, 10, 13, 15, 3, 5, 8,
  2, 1, 14, 7, 4, 10, 8, 13, 15, 12, 9, 0, 3, 5, 6, 11,
]

const KEY_RND_SHIFT = [1, 1, 2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 1]
const KEY_PERM_C = [
  56, 48, 40, 32, 24, 16, 8, 0, 57, 49, 41, 33, 25, 17, 9, 1, 58, 50, 42, 34, 26, 18, 10, 2, 59, 51, 43, 35,
]
const KEY_PERM_D = [62, 54, 46, 38, 30, 22, 14, 6, 61, 53, 45, 37, 29, 21, 13, 5, 60, 52, 44, 36, 28, 20, 12, 4, 27, 19, 11, 3]
const KEY_COMPRESSION = [
  13, 16, 10, 23, 0, 4, 2, 27, 14, 5, 20, 9, 22, 18, 11, 3, 25, 7, 15, 6, 26, 19, 12, 1, 40, 51, 30, 36, 46, 54, 29,
  39, 50, 44, 32, 47, 43, 48, 38, 55, 33, 52, 45, 41, 49, 35, 28, 31,
]

/** QQ 变体密钥扩展：16 组子密钥，每组 6 字节 */
export function keySchedule(key, schedule, mode) {
  let C = 0
  let D = 0
  for (let i = 0, j = 31; i < 28; ++i, --j) C = (C | bitNum(key, KEY_PERM_C[i], j)) >>> 0
  for (let i = 0, j = 31; i < 28; ++i, --j) D = (D | bitNum(key, KEY_PERM_D[i], j)) >>> 0

  for (let i = 0; i < 16; ++i) {
    const shift = KEY_RND_SHIFT[i]
    C = (((C << shift) | (C >>> (28 - shift))) & 0xfffffff0) >>> 0
    D = (((D << shift) | (D >>> (28 - shift))) & 0xfffffff0) >>> 0
    const toGen = mode === DES_DECRYPT ? 15 - i : i
    schedule[toGen] = new Uint8Array(6)
    for (let j = 0; j < 24; ++j) {
      schedule[toGen][j / 8 | 0] |= bitNumIntr(C, KEY_COMPRESSION[j], 7 - (j % 8))
    }
    for (let j = 24; j < 48; ++j) {
      schedule[toGen][j / 8 | 0] |= bitNumIntr(D, KEY_COMPRESSION[j] - 27, 7 - (j % 8))
    }
  }
}

function ip(state, input) {
  state[0] =
    (bitNum(input, 57, 31) | bitNum(input, 49, 30) | bitNum(input, 41, 29) | bitNum(input, 33, 28) |
      bitNum(input, 25, 27) | bitNum(input, 17, 26) | bitNum(input, 9, 25) | bitNum(input, 1, 24) |
      bitNum(input, 59, 23) | bitNum(input, 51, 22) | bitNum(input, 43, 21) | bitNum(input, 35, 20) |
      bitNum(input, 27, 19) | bitNum(input, 19, 18) | bitNum(input, 11, 17) | bitNum(input, 3, 16) |
      bitNum(input, 61, 15) | bitNum(input, 53, 14) | bitNum(input, 45, 13) | bitNum(input, 37, 12) |
      bitNum(input, 29, 11) | bitNum(input, 21, 10) | bitNum(input, 13, 9) | bitNum(input, 5, 8) |
      bitNum(input, 63, 7) | bitNum(input, 55, 6) | bitNum(input, 47, 5) | bitNum(input, 39, 4) |
      bitNum(input, 31, 3) | bitNum(input, 23, 2) | bitNum(input, 15, 1) | bitNum(input, 7, 0)) >>> 0
  state[1] =
    (bitNum(input, 56, 31) | bitNum(input, 48, 30) | bitNum(input, 40, 29) | bitNum(input, 32, 28) |
      bitNum(input, 24, 27) | bitNum(input, 16, 26) | bitNum(input, 8, 25) | bitNum(input, 0, 24) |
      bitNum(input, 58, 23) | bitNum(input, 50, 22) | bitNum(input, 42, 21) | bitNum(input, 34, 20) |
      bitNum(input, 26, 19) | bitNum(input, 18, 18) | bitNum(input, 10, 17) | bitNum(input, 2, 16) |
      bitNum(input, 60, 15) | bitNum(input, 52, 14) | bitNum(input, 44, 13) | bitNum(input, 36, 12) |
      bitNum(input, 28, 11) | bitNum(input, 20, 10) | bitNum(input, 12, 9) | bitNum(input, 4, 8) |
      bitNum(input, 62, 7) | bitNum(input, 54, 6) | bitNum(input, 46, 5) | bitNum(input, 38, 4) |
      bitNum(input, 30, 3) | bitNum(input, 22, 2) | bitNum(input, 14, 1) | bitNum(input, 6, 0)) >>> 0
}

function invIp(state, input) {
  input[3] = bitNumIntr(state[1], 7, 7) | bitNumIntr(state[0], 7, 6) | bitNumIntr(state[1], 15, 5) | bitNumIntr(state[0], 15, 4) | bitNumIntr(state[1], 23, 3) | bitNumIntr(state[0], 23, 2) | bitNumIntr(state[1], 31, 1) | bitNumIntr(state[0], 31, 0)
  input[2] = bitNumIntr(state[1], 6, 7) | bitNumIntr(state[0], 6, 6) | bitNumIntr(state[1], 14, 5) | bitNumIntr(state[0], 14, 4) | bitNumIntr(state[1], 22, 3) | bitNumIntr(state[0], 22, 2) | bitNumIntr(state[1], 30, 1) | bitNumIntr(state[0], 30, 0)
  input[1] = bitNumIntr(state[1], 5, 7) | bitNumIntr(state[0], 5, 6) | bitNumIntr(state[1], 13, 5) | bitNumIntr(state[0], 13, 4) | bitNumIntr(state[1], 21, 3) | bitNumIntr(state[0], 21, 2) | bitNumIntr(state[1], 29, 1) | bitNumIntr(state[0], 29, 0)
  input[0] = bitNumIntr(state[1], 4, 7) | bitNumIntr(state[0], 4, 6) | bitNumIntr(state[1], 12, 5) | bitNumIntr(state[0], 12, 4) | bitNumIntr(state[1], 20, 3) | bitNumIntr(state[0], 20, 2) | bitNumIntr(state[1], 28, 1) | bitNumIntr(state[0], 28, 0)
  input[7] = bitNumIntr(state[1], 3, 7) | bitNumIntr(state[0], 3, 6) | bitNumIntr(state[1], 11, 5) | bitNumIntr(state[0], 11, 4) | bitNumIntr(state[1], 19, 3) | bitNumIntr(state[0], 19, 2) | bitNumIntr(state[1], 27, 1) | bitNumIntr(state[0], 27, 0)
  input[6] = bitNumIntr(state[1], 2, 7) | bitNumIntr(state[0], 2, 6) | bitNumIntr(state[1], 10, 5) | bitNumIntr(state[0], 10, 4) | bitNumIntr(state[1], 18, 3) | bitNumIntr(state[0], 18, 2) | bitNumIntr(state[1], 26, 1) | bitNumIntr(state[0], 26, 0)
  input[5] = bitNumIntr(state[1], 1, 7) | bitNumIntr(state[0], 1, 6) | bitNumIntr(state[1], 9, 5) | bitNumIntr(state[0], 9, 4) | bitNumIntr(state[1], 17, 3) | bitNumIntr(state[0], 17, 2) | bitNumIntr(state[1], 25, 1) | bitNumIntr(state[0], 25, 0)
  input[4] = bitNumIntr(state[1], 0, 7) | bitNumIntr(state[0], 0, 6) | bitNumIntr(state[1], 8, 5) | bitNumIntr(state[0], 8, 4) | bitNumIntr(state[1], 16, 3) | bitNumIntr(state[0], 16, 2) | bitNumIntr(state[1], 24, 1) | bitNumIntr(state[0], 24, 0)
}

function f(state, key) {
  const lrg = new Uint8Array(6)
  let t1 =
    bitNumIntl(state, 31, 0) | ((state & 0xf0000000) >>> 1) | bitNumIntl(state, 4, 5) | bitNumIntl(state, 3, 6) |
    ((state & 0x0f000000) >>> 3) | bitNumIntl(state, 8, 11) | bitNumIntl(state, 7, 12) | ((state & 0x00f00000) >>> 5) |
    bitNumIntl(state, 12, 17) | bitNumIntl(state, 11, 18) | ((state & 0x000f0000) >>> 7) | bitNumIntl(state, 16, 23)
  let t2 =
    bitNumIntl(state, 15, 0) | ((state & 0x0000f000) << 15) | bitNumIntl(state, 20, 5) | bitNumIntl(state, 19, 6) |
    ((state & 0x00000f00) << 13) | bitNumIntl(state, 24, 11) | bitNumIntl(state, 23, 12) | ((state & 0x000000f0) << 11) |
    bitNumIntl(state, 28, 17) | bitNumIntl(state, 27, 18) | ((state & 0x0000000f) << 9) | bitNumIntl(state, 0, 23)
  t1 >>>= 0
  t2 >>>= 0

  lrg[0] = (t1 >>> 24) & 0xff
  lrg[1] = (t1 >>> 16) & 0xff
  lrg[2] = (t1 >>> 8) & 0xff
  lrg[3] = (t2 >>> 24) & 0xff
  lrg[4] = (t2 >>> 16) & 0xff
  lrg[5] = (t2 >>> 8) & 0xff

  lrg[0] ^= key[0]
  lrg[1] ^= key[1]
  lrg[2] ^= key[2]
  lrg[3] ^= key[3]
  lrg[4] ^= key[4]
  lrg[5] ^= key[5]

  state =
    ((SBOX1[sboxBit(lrg[0] >>> 2)] << 28) |
      (SBOX2[sboxBit(((lrg[0] & 0x03) << 4) | (lrg[1] >>> 4))] << 24) |
      (SBOX3[sboxBit(((lrg[1] & 0x0f) << 2) | (lrg[2] >>> 6))] << 20) |
      (SBOX4[sboxBit(lrg[2] & 0x3f)] << 16) |
      (SBOX5[sboxBit(lrg[3] >>> 2)] << 12) |
      (SBOX6[sboxBit(((lrg[3] & 0x03) << 4) | (lrg[4] >>> 4))] << 8) |
      (SBOX7[sboxBit(((lrg[4] & 0x0f) << 2) | (lrg[5] >>> 6))] << 4) |
      SBOX8[sboxBit(lrg[5] & 0x3f)]) >>> 0

  state =
    (bitNumIntl(state, 15, 0) | bitNumIntl(state, 6, 1) | bitNumIntl(state, 19, 2) | bitNumIntl(state, 20, 3) |
      bitNumIntl(state, 28, 4) | bitNumIntl(state, 11, 5) | bitNumIntl(state, 27, 6) | bitNumIntl(state, 16, 7) |
      bitNumIntl(state, 0, 8) | bitNumIntl(state, 14, 9) | bitNumIntl(state, 22, 10) | bitNumIntl(state, 25, 11) |
      bitNumIntl(state, 4, 12) | bitNumIntl(state, 17, 13) | bitNumIntl(state, 30, 14) | bitNumIntl(state, 9, 15) |
      bitNumIntl(state, 1, 16) | bitNumIntl(state, 7, 17) | bitNumIntl(state, 23, 18) | bitNumIntl(state, 13, 19) |
      bitNumIntl(state, 31, 20) | bitNumIntl(state, 26, 21) | bitNumIntl(state, 2, 22) | bitNumIntl(state, 8, 23) |
      bitNumIntl(state, 18, 24) | bitNumIntl(state, 12, 25) | bitNumIntl(state, 29, 26) | bitNumIntl(state, 5, 27) |
      bitNumIntl(state, 21, 28) | bitNumIntl(state, 10, 29) | bitNumIntl(state, 3, 30) | bitNumIntl(state, 24, 31)) >>> 0

  return state
}

/** 单次 DES（8 字节 input → 8 字节 output） */
export function desCrypt(input, output, key) {
  const state = [0, 0]
  ip(state, input)
  for (let idx = 0; idx < 15; ++idx) {
    const t = state[1]
    state[1] = (f(state[1], key[idx]) ^ state[0]) >>> 0
    state[0] = t
  }
  state[0] = (f(state[1], key[15]) ^ state[0]) >>> 0
  invIp(state, output)
}

/** 3DES 密钥扩展（QQ 变体）：返回 3×16 组子密钥 */
export function tripleDesKeySetup(key, mode = DES_DECRYPT) {
  const schedule = [[], [], []]
  if (mode === DES_ENCRYPT) {
    keySchedule(key.subarray(0, 8), schedule[0], mode)
    keySchedule(key.subarray(8, 16), schedule[1], DES_DECRYPT)
    keySchedule(key.subarray(16, 24), schedule[2], mode)
  } else {
    keySchedule(key.subarray(0, 8), schedule[2], mode)
    keySchedule(key.subarray(8, 16), schedule[1], DES_ENCRYPT)
    keySchedule(key.subarray(16, 24), schedule[0], mode)
  }
  return schedule
}

/** 3DES 解密一个 8 字节块 */
export function tripleDesCrypt(input, output, schedule) {
  desCrypt(input, output, schedule[0])
  desCrypt(output, output, schedule[1])
  desCrypt(output, output, schedule[2])
}

/** hex 字符串 → bytes（奇数长度时丢弃最后一个半字节） */
export function hexToBytes(hex) {
  const s = String(hex || '').trim()
  const n = s.length >> 1
  const out = new Uint8Array(n)
  for (let i = 0; i < n; i++) out[i] = parseInt(s.substr(i * 2, 2), 16)
  return out
}

/** 是否为加密 QRC 的 hex 串（偶数长度、≥32、全 hex 字符） */
export function looksLikeQrcHex(text) {
  const s = String(text || '').trim()
  return s.length >= 32 && s.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(s)
}

async function inflateOnce(bytes) {
  if (typeof DecompressionStream !== 'function') throw new Error('当前环境不支持 zlib 解压')
  const ds = new DecompressionStream('deflate')
  const writer = ds.writable.getWriter()
  // 尾部填充会让流以错误结束：write/close 的 rejection 必须就地吞掉（读取端负责判定成败）
  writer.write(bytes).catch(() => {})
  writer.close().catch(() => {})
  const reader = ds.readable.getReader()
  const chunks = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    total += value.length
  }
  const out = new Uint8Array(total)
  let off = 0
  for (const c of chunks) {
    out.set(c, off)
    off += c.length
  }
  return out
}

/**
 * 宽容 zlib 解压：3DES 按 8 字节分组，明文尾部带 1~7 字节填充（通常是 0），
 * 直接解压会因 "trailing junk" 失败 —— 从完整长度开始逐字节截断重试。
 */
async function inflateLoose(bytes) {
  for (let k = 0; k <= 8; k++) {
    const slice = bytes.subarray(0, bytes.length - k)
    if (!slice.length) break
    try {
      return await inflateOnce(slice)
    } catch {
      /* 截断后重试 */
    }
  }
  throw new Error('QRC 解压失败（数据可能已损坏）')
}

/**
 * 解密 hex 加密的歌词载荷 → 明文（QQ 返回 XML（`<Lyric_1 LyricContent="…"/>`）或纯文本）
 * @throws 解密或解压失败（调用方可回退明文 LRC 链路）
 */
export async function decryptQrcHex(hex) {
  const data = hexToBytes(hex)
  if (!data.length) return ''
  const key = new Uint8Array(QQ_KEY_TEXT.length)
  for (let i = 0; i < QQ_KEY_TEXT.length; i++) key[i] = QQ_KEY_TEXT.charCodeAt(i) & 0xff
  const schedule = tripleDesKeySetup(key, DES_DECRYPT)
  const dec = new Uint8Array(data.length)
  const block = new Uint8Array(8)
  const out8 = new Uint8Array(8)
  for (let i = 0; i < data.length; i += 8) {
    block.fill(0)
    block.set(data.subarray(i, Math.min(i + 8, data.length)))
    tripleDesCrypt(block, out8, schedule)
    dec.set(out8.subarray(0, Math.min(8, data.length - i)), i)
  }
  const plain = await inflateLoose(dec)
  return new TextDecoder('utf-8').decode(plain)
}
