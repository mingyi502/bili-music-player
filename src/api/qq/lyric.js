/** 歌词：musicu PlayLyricInfo（QRC 逐字 + 翻译 + 罗马音，加密需解密）+ 明文 LRC 回退。 */
import { request } from './util.js'
import { musicuCall } from './comm.js'
import { looksLikeQrcHex, decryptQrcHex } from '../../utils/qqc3des.js'

/** base64 → UTF-8 文本（浏览器 / WebView / Node 均可用 atob + TextDecoder） */
export function decodeBase64Utf8(b64) {
  if (!b64) return ''
  try {
    const bin = atob(String(b64))
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
    return new TextDecoder('utf-8').decode(bytes)
  } catch {
    return ''
  }
}

/**
 * 解密 / 解码歌词载荷：
 * - hex（qrc/roma 模式返回的 3DES 加密数据）→ 解密 + zlib
 * - 其它 → base64 UTF-8（明文 LRC 链路）
 */
export async function decodeLyricPayload(value) {
  const s = String(value || '')
  if (!s) return ''
  if (looksLikeQrcHex(s)) {
    try {
      return await decryptQrcHex(s)
    } catch {
      return ''
    }
  }
  return decodeBase64Utf8(s)
}

/**
 * 取歌词（逐字 + 翻译 + 罗马音；拿不到逐字时回退行级 LRC）。
 *
 * 两个来源：
 * 1. musicu `music.musichallSong.PlayLyricInfo`：`qrc:1, roma:1, trans:1`
 *    （响应为加密 hex，返回 **QRC/XML** 文本；`trans` 多为 LRC、`roma` 多为 QRC）
 * 2. 同接口 `format:1`（明文 base64 LRC + 翻译，翻译覆盖率最好；部分老歌只有它）
 * 3. 旧接口 `fcg_query_lyric_new.fcg`（musicu 返回空时兜底，基本无翻译）
 *
 * @returns {Promise<{ lyric: string, trans: string, roma: string, qrc: boolean, source: 'musicu'|'legacy'|'' }>}
 */
export async function fetchLyric(songmid, cookie, uin) {
  if (!songmid) return { lyric: '', trans: '', roma: '', qrc: false, source: '' }

  // 1) 逐字（QRC）+ 翻译 + 罗马音
  try {
    const data = await musicuCall(
      'music.musichallSong.PlayLyricInfo',
      'GetPlayLyricInfo',
      { crypt: 1, lrc_t: 0, qrc: 1, qrc_t: 0, roma: 1, roma_t: 0, trans: 1, trans_t: 0, songMID: songmid, songType: 0 },
      { key: 'req_1', cookie, uin, timeout: 12000 }
    )
    const lyric = await decodeLyricPayload(data?.lyric)
    if (lyric) {
      return {
        lyric,
        trans: await decodeLyricPayload(data?.trans),
        roma: await decodeLyricPayload(data?.roma),
        qrc: true,
        source: 'musicu',
      }
    }
  } catch {
    /* 回退明文链路 */
  }

  // 2) 明文 LRC（format: 1）+ 翻译
  try {
    const data = await musicuCall(
      'music.musichallSong.PlayLyricInfo',
      'GetPlayLyricInfo',
      { format: 1, songMID: songmid, songType: 0, trans: 1 },
      { key: 'req_1', cookie, uin, timeout: 12000 }
    )
    const lyric = decodeBase64Utf8(data?.lyric)
    if (lyric) {
      return { lyric, trans: decodeBase64Utf8(data?.trans), roma: '', qrc: false, source: 'musicu' }
    }
  } catch {
    /* 回退旧接口 */
  }

  // 3) 旧接口兜底
  const data = await request(
    '/lyric/fcgi-bin/fcg_query_lyric_new.fcg',
    {
      songmid,
      g_tk: 5381,
      format: 'json',
      inCharset: 'utf8',
      outCharset: 'utf-8',
      notice: 0,
      platform: 'yqq',
      needNewCode: 0,
    },
    cookie,
    12000
  )
  const code = data.retcode ?? data.code ?? 0
  if (code === -1901 || code === 1901) {
    throw new Error('QQ 音乐暂无歌词（冷门或未上架曲目常见）')
  }
  if (code !== 0) throw new Error(`歌词接口返回 code=${code}${data.subcode ? `/${data.subcode}` : ''}`)
  return { lyric: decodeBase64Utf8(data.lyric), trans: decodeBase64Utf8(data.trans), roma: '', qrc: false, source: 'legacy' }
}
