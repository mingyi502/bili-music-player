/**
 * QRC 逐字歌词解析（平台无关，纯函数）。
 *
 * QRC 文本格式（QQ 音乐）：
 * ```
 * [ti:歌名]
 * [ar:歌手]
 * [offset:0]
 * [行起始ms,行时长ms]词(词起始ms,词时长ms)词(词起始ms,词时长ms)…
 * ```
 * - 词时间 **绝对**（从音频起点算，单位 ms）；空文本的 `(t,d)` 表示空格单元
 * - 翻译 / 罗马音同构（通常整行一个词）
 * - musicu 返回的是 XML（`<Lyric_1 LyricContent="…"/>`，属性内是原始换行），
 *   也可能直接返回纯文本（`lyric_download.fcg` 等旧路径）
 *
 * 输出统一为秒：`[{ time, duration, text, words: [{ text, time, duration }] }]`
 */
import { parseLrc } from './lrc.js'

const QRC_LINE_RE = /^\[(\d+),(\d+)\](.*)$/
const QRC_META_RE = /^\[(ti|ar|al|by|offset|language|re|total):(.*)\]$/i
const WORD_TIME_RE = /\((\d+),(\d+)\)/g

/** 从 musicu 的 XML 载荷中提取 LyricContent（兼容直接给纯文本） */
export function extractQrcText(raw) {
  const text = String(raw || '')
  if (!text) return ''
  if (!/<Lyric_1\b|<QrcInfos\b/.test(text)) return text
  const m = text.match(/<Lyric_1\b[^>]*\bLyricContent="([\s\S]*?)"\s*\/?>/)
  if (!m) return ''
  return unescapeXml(m[1])
}

function unescapeXml(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

/** 解析一行 QRC 正文 → `{ text, words }`；不是 QRC 行返回 null */
export function parseQrcLine(body) {
  WORD_TIME_RE.lastIndex = 0
  const words = []
  let last = 0
  let m
  while ((m = WORD_TIME_RE.exec(body))) {
    words.push({
      text: body.slice(last, m.index),
      time: Number(m[1]) / 1000,
      duration: Number(m[2]) / 1000,
    })
    last = WORD_TIME_RE.lastIndex
  }
  if (!words.length) return null
  const tail = body.slice(last)
  if (tail) words[words.length - 1].text += tail
  return { words, text: words.map((w) => w.text).join('') }
}

/**
 * 解析 QRC 文本 → 行数组（按行起始升序，时间单位秒）
 * 行 `[offset:]` 标签按 QRC 约定修正（正 = 歌词延后，与 LRC 的 offset 语义一致）
 */
export function parseQrc(raw) {
  const text = extractQrcText(raw)
  if (!text) return []
  const lines = []
  let offset = 0
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    const meta = line.match(QRC_META_RE)
    if (meta) {
      if (meta[1].toLowerCase() === 'offset') {
        const n = Number(meta[2].trim())
        if (Number.isFinite(n)) offset = n / 1000
      }
      continue
    }
    const m = line.match(QRC_LINE_RE)
    if (!m) continue
    const parsed = parseQrcLine(m[3])
    if (!parsed || !parsed.text.trim()) continue
    const shift = -offset
    lines.push({
      time: Math.max(0, Number(m[1]) / 1000 + shift),
      duration: Number(m[2]) / 1000,
      text: parsed.text,
      words: parsed.words.map((w) => ({ ...w, time: Math.max(0, w.time + shift) })),
    })
  }
  return lines.sort((a, b) => a.time - b.time)
}

const msKey = (t) => Math.round(t * 1000)

/** 翻译版权/来源声明行（QQ 的翻译 LRC 首行常见），不并入歌词 */
export const TRANSLATION_CREDIT_RE = /享有本翻译作品的著作权|本翻译作品|^翻译[:：]|TME享有/

/**
 * 把翻译 / 罗马音（QRC 或 LRC 文本）按行起始时间合并进行级歌词。
 * @param {Array} lines parseQrc 的结果
 * @param {string} raw 翻译 / 罗马音载荷（QRC XML、QRC 文本或 LRC 文本）
 * @param {'trans'|'roma'} field 合并到哪个字段
 */
export function mergeQrcExtra(lines, raw, field = 'trans') {
  const text = extractQrcText(raw)
  if (!text || !lines?.length) return lines
  // 翻译多为 LRC 文本，罗马音多为 QRC 文本：两种格式都尝试
  let extra = parseQrc(text)
  if (!extra.length) extra = parseLrc(text).map((l) => ({ time: l.time, text: l.text }))
  if (!extra.length) return lines
  const map = new Map()
  for (const e of extra) {
    const t = (e.text || '').trim()
    if (!t || t === '//') continue
    if (field === 'trans' && TRANSLATION_CREDIT_RE.test(t)) continue
    if (!map.has(msKey(e.time))) map.set(msKey(e.time), t)
  }
  if (!map.size) return lines
  return lines.map((line) => {
    const key = msKey(line.time)
    let hit = map.get(key)
    if (!hit) {
      for (let d = 1; d <= 50 && !hit; d++) hit = map.get(key + d) || map.get(key - d)
    }
    return hit ? { ...line, [field]: hit } : line
  })
}

/**
 * 标记「信息行」：QRC 开头常有一行「歌名 - 歌手 (原名)」的计时有词行，
 * 不是真正的歌词 —— 标记 `credit` 后界面弱化显示且不参与卡拉 OK 高亮。
 * 只检查前 3 行，且要求行文本以歌名开头并包含歌手，避免误伤真实歌词。
 */
export function markCreditLines(lines, song) {
  if (!lines?.length || !song?.name) return lines
  const norm = (s) => String(s || '').replace(/\s+/g, '').toLowerCase()
  const name = norm(song.name)
  const singers = (song.singers || []).map(norm).filter(Boolean)
  if (!name) return lines
  return lines.map((line, i) => {
    if (i > 2 || line.credit) return line
    const t = norm(line.text)
    const hit = (t === name || t.startsWith(name)) && (singers.length === 0 || singers.some((s) => t.includes(s)))
    return hit ? { ...line, credit: true } : line
  })
}

/**
 * 当前词状态（供卡拉 OK 渲染）：
 * @param {Array} words 行内词
 * @param {number} time 当前歌词时间（秒，已含校准偏移）
 * @returns {{ index: number, progress: number }} 当前词下标（-1 = 尚未开始）与词内进度 0~1
 */
export function wordState(words, time) {
  if (!words?.length) return { index: -1, progress: 0 }
  let index = -1
  for (let i = 0; i < words.length; i++) {
    if (words[i].time > time) break
    index = i
  }
  if (index < 0) return { index: -1, progress: 0 }
  const w = words[index]
  const p = w.duration > 0 ? (time - w.time) / w.duration : 1
  return { index, progress: Math.max(0, Math.min(1, p)) }
}
