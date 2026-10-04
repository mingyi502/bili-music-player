/**
 * 歌单导入导出 store（P7.4 G5）：
 * - 导出当前浏览歌单（JSON / m3u）→ App 写 External 专属目录，Web 走浏览器下载
 * - 导入文件（JSON / m3u）→ 二次确认 → 无 mid 条目搜索补全 → 创建新歌单并批量加歌
 */
import { state } from './state.js'
import { toast, askConfirm } from './ui.js'
import { saveTextFile } from '../core/files.js'
import { ensureWritable, toastWriteError } from './write.js'
import { playlistToJsonText, playlistToM3u, sanitizeFileName, parsePlaylistFile } from '../api/transfer.js'
import { createPlaylist as apiCreatePlaylist, addSongsToPlaylist as apiAddSongs, chunk } from '../api/qq/playlistWrite.js'
import { fetchTracksByMids } from '../api/qq/song.js'
import { searchByType } from '../api/qq/search.js'
import { invalidateLibrary } from './library.js'

const opts = () => ({ cookie: state.config.qqCookie, uin: state.config.uin })

/** 当前浏览歌单是否可导出（需已加载歌曲） */
export function canExportPlaylist() {
  return !!(state.playlist && (state.songs || []).length)
}

/** 导出当前歌单 → 保存文件（App 持久目录 / Web 下载） */
export async function exportCurrentPlaylist(format = 'json') {
  const playlist = state.playlist
  const songs = state.songs || []
  if (!playlist || !songs.length) {
    toast('当前没有可导出的歌单', 'error')
    return null
  }
  const base = sanitizeFileName(playlist.name || '歌单')
  const ext = format === 'm3u' ? 'm3u' : 'json'
  const fileName = `${base}.${ext}`
  const text = format === 'm3u' ? playlistToM3u(playlist, songs) : playlistToJsonText(playlist, songs)
  try {
    const res = await saveTextFile(fileName, text)
    state.ui.lastExport = {
      fileName,
      format,
      count: songs.length,
      size: Number(res?.size) || text.length,
      path: res?.path || fileName,
      web: !!res?.web,
    }
    toast(`已导出 ${songs.length} 首 → ${fileName}`, 'success')
    return { ...res, fileName, format, text }
  } catch (e) {
    toast(`导出失败：${e.message || '未知错误'}`, 'error')
    return null
  }
}

/** 读取 File 文本（Web / App 通用） */
export function readFileText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('读取文件失败'))
    reader.readAsText(file)
  })
}

/** 补全歌曲信息（G5 导入）：
 *  1) 有 mid 缺数字 id → 批量查 track info（写歌单接口需要 songId）
 *  2) 无 mid → 按「歌名 + 歌手」搜索（最多 limit 条）
 *  返回补全数量；仍缺数字 id 的条目由调用方跳过。
 */
export async function resolveSongs(songs, { limit = 50, onProgress } = {}) {
  let resolved = 0
  const needInfo = (songs || []).filter((s) => s.mid && !Number(s.id))
  let done = 0
  for (const batch of chunk(needInfo, 50)) {
    try {
      const tracks = await fetchTracksByMids(batch.map((s) => s.mid), opts())
      for (const s of batch) {
        const hit = tracks.find((t) => t.mid === s.mid)
        if (!hit?.id) continue
        s.id = hit.id
        if (!s.name) s.name = hit.name
        if (!(s.singers || []).length) s.singers = hit.singers
        if (!s.album) s.album = hit.album
        if (!s.interval) s.interval = hit.interval
        resolved += 1
      }
    } catch {
      /* 单批失败不阻断整体导入 */
    }
    done += batch.length
    onProgress?.(done, needInfo.length + Math.min(limit, (songs || []).filter((s) => !s.mid && s.name).length))
  }
  const missing = (songs || []).filter((s) => !s.mid && s.name).slice(0, limit)
  for (let i = 0; i < missing.length; i++) {
    const s = missing[i]
    try {
      const keyword = [s.name, ...(s.singers || [])].join(' ')
      const res = await searchByType(keyword, 'song', { page: 1, pageSize: 1, cookie: state.config.qqCookie })
      const hit = res?.list?.[0]
      if (hit?.mid) {
        s.mid = hit.mid
        if (hit.id) s.id = hit.id
        if (!s.name) s.name = hit.name || ''
        if (!(s.singers || []).length) s.singers = hit.singers || []
        if (!s.interval) s.interval = hit.interval || 0
        resolved += 1
      }
    } catch {
      /* 单条失败不阻断整体导入 */
    }
    onProgress?.(needInfo.length + i + 1, needInfo.length + missing.length)
  }
  return resolved
}

/** 导入文本 → 创建歌单 + 加歌（带二次确认与进度提示） */
export async function importPlaylistText(text, fileName = '') {
  if (!ensureWritable()) return null
  let parsed
  try {
    parsed = parsePlaylistFile(fileName, text)
  } catch (e) {
    toast(`导入失败：${e.message}`, 'error')
    return null
  }
  const name = (parsed.name || String(fileName).replace(/\.[^.]+$/, '') || '导入歌单').trim().slice(0, 30)
  const ok = await askConfirm({
    title: '导入歌单',
    message: `将创建新歌单《${name}》并加入 ${parsed.songs.length} 首歌曲（${parsed.format.toUpperCase()} 格式）。`,
    confirmText: '导入',
  })
  if (!ok) return null
  try {
    state.ui.importBusy = true
    state.ui.importText = `正在解析歌曲（0/${parsed.songs.length}）…`
    const resolved = await resolveSongs(parsed.songs, {
      onProgress: (i, n) => {
        state.ui.importText = `正在解析歌曲（${i}/${n}）…`
      },
    })
    const writable = parsed.songs.filter((s) => Number(s.id))
    const skipped = parsed.songs.length - writable.length
    if (!writable.length) throw new Error('没有可导入的歌曲（缺少歌曲数字 ID）')
    state.ui.importText = '正在创建歌单…'
    const res = await apiCreatePlaylist(name, opts())
    if (!res.dirId) throw new Error('创建歌单失败')
    state.ui.importText = `正在写入歌曲（共 ${writable.length} 首）…`
    const stat = await apiAddSongs(res.dirId, res.tid, writable, opts())
    state.playlists = [
      ...state.playlists,
      { id: String(res.tid || ''), name: res.name || name, cover: '', songCount: stat.added, listenNum: 0, dirId: res.dirId, kind: 'created' },
    ]
    const extra = stat.existed ? `，已存在 ${stat.existed} 首` : ''
    const miss = writable.length - stat.added - stat.existed
    toast(
      `已导入《${res.name || name}》：新增 ${stat.added} 首${extra}${miss > 0 ? `，失败 ${miss} 首` : ''}${skipped > 0 ? `，跳过 ${skipped} 首` : ''}${resolved ? `（${resolved} 首由接口补全）` : ''}`,
      stat.added ? 'success' : 'info'
    )
    await invalidateLibrary('playlists')
    return { ...stat, dirId: res.dirId, tid: res.tid, name: res.name || name, resolved, skipped }
  } catch (e) {
    toastWriteError(e)
    return null
  } finally {
    state.ui.importBusy = false
    state.ui.importText = ''
  }
}

/** 导入 File 对象（<input type=file>） */
export async function importPlaylistFile(file) {
  if (!file) return null
  try {
    const text = await readFileText(file)
    return await importPlaylistText(text, file.name || '')
  } catch (e) {
    toast(`导入失败：${e.message}`, 'error')
    return null
  }
}
