/**
 * 歌单导入导出纯函数（P7.4 G5）：
 * - 导出：JSON（本应用格式，可无损再导入）/ m3u（通用播放列表，含 QQ 歌曲链接）
 * - 导入：解析 JSON / m3u → `{ name, songs }`；不碰 localStorage / state（便于单测）
 */

export const TRANSFER_FORMAT = 'bmp-playlist'
export const TRANSFER_VERSION = 1

/** 文件名安全化（去掉路径/系统非法字符） */
export function sanitizeFileName(name) {
  const s = String(name || '')
    .replace(/[\\/:*?"<>|\r\n\t]/g, '_')
    .trim()
    .slice(0, 60)
  return s || '歌单'
}

/** 歌曲 → 导出结构（只保留重建歌单所需字段） */
export function songToExport(song) {
  return {
    mid: song?.mid || '',
    id: song?.id || '',
    name: song?.name || '',
    singers: song?.singers || [],
    album: song?.album || '',
    interval: Number(song?.interval) || 0,
  }
}

/** 歌单 + 歌曲 → 导出对象 */
export function toJsonPlaylist(playlist, songs) {
  return {
    format: TRANSFER_FORMAT,
    version: TRANSFER_VERSION,
    name: playlist?.name || '未命名歌单',
    exportedAt: new Date().toISOString(),
    count: (songs || []).length,
    songs: (songs || []).map(songToExport),
  }
}

/** 歌单 + 歌曲 → JSON 文本 */
export function playlistToJsonText(playlist, songs) {
  return JSON.stringify(toJsonPlaylist(playlist, songs), null, 2)
}

/** 歌单 + 歌曲 → m3u 文本（EXTINF + QQ 歌曲详情链接） */
export function playlistToM3u(playlist, songs) {
  const lines = ['#EXTM3U', `#PLAYLIST:${playlist?.name || '未命名歌单'}`]
  for (const s of songs || []) {
    const artists = (s?.singers || []).join('/') || '未知歌手'
    lines.push(`#EXTINF:${Math.round(Number(s?.interval) || 0)},${artists} - ${s?.name || ''}`)
    if (s?.mid) lines.push(`https://y.qq.com/n/ryqq/songDetail/${s.mid}`)
    else if (s?.id) lines.push(`bmp://local/${encodeURIComponent(s.id)}`)
    else lines.push(`bmp://local/${encodeURIComponent(s?.name || '')}`)
  }
  return lines.join('\n') + '\n'
}

function normalizeSong(s) {
  return {
    mid: s?.mid || '',
    id: s?.id || '',
    name: s?.name || '',
    singers: Array.isArray(s?.singers) ? s.singers : s?.singers ? [String(s.singers)] : [],
    album: s?.album || '',
    interval: Number(s?.interval) || 0,
  }
}

/** 解析 m3u / m3u8 文本 → `{ name, songs }` */
export function parseM3u(text) {
  const lines = String(text || '').split(/\r?\n/)
  let name = ''
  const songs = []
  let pending = null
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    if (/^#PLAYLIST:/i.test(line)) {
      name = line.slice(10).trim()
      continue
    }
    if (/^#EXTINF:/i.test(line)) {
      const body = line.slice(8)
      const comma = body.indexOf(',')
      const dur = comma >= 0 ? Number(body.slice(0, comma)) : 0
      const title = comma >= 0 ? body.slice(comma + 1).trim() : ''
      const dash = title.indexOf(' - ')
      pending = {
        mid: '',
        id: '',
        name: dash > 0 ? title.slice(dash + 3).trim() : title,
        singers: dash > 0 ? [title.slice(0, dash).trim()] : [],
        album: '',
        interval: Number.isFinite(dur) ? dur : 0,
      }
      continue
    }
    if (line.startsWith('#')) continue
    const m = line.match(/songDetail\/([A-Za-z0-9]+)/)
    const song = pending || { mid: '', id: '', name: '', singers: [], album: '', interval: 0 }
    if (m) song.mid = m[1]
    else if (!pending) {
      try {
        song.name = decodeURIComponent(line.replace(/^bmp:\/\/local\//, ''))
      } catch {
        song.name = line
      }
    }
    songs.push(song)
    pending = null
  }
  return { name, songs }
}

/** 解析本应用 JSON 导出（也接受纯歌曲数组）→ `{ name, songs }` */
export function parsePlaylistJson(text) {
  const data = JSON.parse(text)
  if (Array.isArray(data)) return { name: '', songs: data.map(normalizeSong) }
  if (!data || data.format !== TRANSFER_FORMAT) throw new Error('不是本应用导出的歌单 JSON')
  if (Number(data.version) > TRANSFER_VERSION) throw new Error('歌单文件版本过新，请升级应用后再导入')
  return { name: data.name || '', songs: (data.songs || []).map(normalizeSong) }
}

/** 按文件名/内容判断格式：`json` | `m3u` */
export function detectFormat(fileName, text) {
  if (/\.m3u8?$/i.test(String(fileName || ''))) return 'm3u'
  if (/\.json$/i.test(String(fileName || ''))) return 'json'
  const t = String(text || '').trim()
  return t.startsWith('{') || t.startsWith('[') ? 'json' : 'm3u'
}

/** 导入文本 → `{ name, songs, format }`（自动识别格式） */
export function parsePlaylistFile(fileName, text) {
  const format = detectFormat(fileName, text)
  const parsed = format === 'json' ? parsePlaylistJson(text) : parseM3u(text)
  const songs = (parsed.songs || []).filter((s) => s.mid || s.name)
  if (!songs.length) throw new Error('文件里没有可识别的歌曲')
  return { name: parsed.name || '', songs, format }
}
