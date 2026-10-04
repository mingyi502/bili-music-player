/**
 * 下载 / 本地音乐 store（P6）。
 *
 * - `downloadSong(song)`：解析直链（QQ 优先按偏好，失败回退 B站）→ 原生下载到持久目录 → 索引
 * - `queueDownloads(songs)`：批量队列（**并发 2**，失败进失败清单，可重试；不做断点续传）
 * - `removeDownload(song)` / `retryFailedDownloads()`
 * - `importLocalFiles(files)`：本地文件（File 对象）→ base64 → 私有目录 → 索引
 * - 离线播放由 player.js 处理（`startPlayback` 命中 `state.downloads` 或 `song.localUri`）
 */
import { state, songKey } from './state.js'
import { toast, askConfirm } from './ui.js'
import { hasDownloads, downloadBackend } from '../core/downloads.js'
import { resolveDownloadUrl } from './player.js'
import { formatBytes, parseLocalFileName, extFromFileName } from '../api/downloads.js'

/** 能力查询再导出（UI 用 store 统一入口） */
export { hasDownloads, downloadBackend }

const CONCURRENCY = 2

/** 索引持久化（直接写 LS，避免把整个 config 写一遍） */
function persistIndex(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* 配额异常不打断 */
  }
}

function pickSong(song) {
  return {
    id: String(song.id || ''),
    mid: song.mid || '',
    name: song.name || '未知歌曲',
    singers: song.singers || [],
    album: song.album || '',
    albumMid: song.albumMid || '',
    cover: song.cover || '',
    interval: song.interval || 0,
  }
}

export function downloadOf(song) {
  return state.downloads[songKey(song)] || null
}
export function isDownloaded(song) {
  return downloadOf(song)?.status === 'done'
}
export function isDownloading(song) {
  const s = downloadOf(song)?.status
  return s === 'downloading' || s === 'pending'
}

function setRecord(key, rec) {
  state.downloads = { ...state.downloads, [key]: rec }
  persistIndex('bmp:downloads', state.downloads)
}

/**
 * 下载单曲（幂等：已下载直接返回；进行中不重复触发）。
 * @param {{ silent?: boolean }} opts
 */
export async function downloadSong(song, { silent = false } = {}) {
  if (!song) return null
  if (!hasDownloads()) {
    if (!silent) toast('当前环境不支持下载（仅 App）', 'error')
    return null
  }
  const key = songKey(song)
  const cur = state.downloads[key]
  if (cur?.status === 'done') {
    if (!silent) toast('该歌曲已下载', 'info')
    return cur
  }
  if (cur?.status === 'downloading') return null
  setRecord(key, { key, song: pickSong(song), status: 'downloading', progress: 0, error: '', createdAt: Date.now() })
  try {
    const { url, source } = await resolveDownloadUrl(song)
    const res = await downloadBackend().downloadAudio({
      url,
      key,
      onProgress: (p) => {
        const rec = state.downloads[key]
        if (rec?.status === 'downloading') setRecord(key, { ...rec, progress: p })
      },
    })
    const rec = {
      key,
      song: pickSong(song),
      status: 'done',
      progress: 1,
      path: res.path,
      ext: res.ext,
      uri: res.uri,
      size: res.size,
      source,
      createdAt: Date.now(),
      error: '',
    }
    setRecord(key, rec)
    if (!silent) toast(`已下载：${song.name}（${formatBytes(res.size)}）`, 'success')
    return rec
  } catch (e) {
    const rec = { ...state.downloads[key], status: 'failed', error: e?.message || '下载失败', createdAt: Date.now() }
    setRecord(key, rec)
    if (!silent) toast(`下载失败：${song.name}（${rec.error}）`, 'error')
    return null
  }
}

/** 批量下载（并发 2，失败清单可重试） */
export async function queueDownloads(songs) {
  if (!hasDownloads()) {
    toast('当前环境不支持下载（仅 App）', 'error')
    return
  }
  const list = (songs || []).filter(Boolean)
  const fresh = list.filter((s) => !isDownloaded(s) && !isDownloading(s))
  if (!fresh.length) {
    toast('所选歌曲都已下载', 'info')
    return
  }
  state.downloadQueue = fresh.map((s) => ({ key: songKey(s), song: pickSong(s), status: 'pending' }))
  toast(`开始下载 ${fresh.length} 首（并发 ${CONCURRENCY}）`, 'info')
  await runQueue()
}

async function runQueue() {
  const pending = state.downloadQueue.filter((x) => x.status === 'pending')
  for (let i = 0; i < pending.length; i += CONCURRENCY) {
    const batch = pending.slice(i, i + CONCURRENCY)
    for (const item of batch) item.status = 'running'
    await Promise.allSettled(batch.map((item) => downloadSong(item.song, { silent: true })))
    for (const item of batch) {
      item.status = isDownloaded(item.song) ? 'done' : 'failed'
    }
  }
  const failed = state.downloadQueue.filter((x) => x.status === 'failed').length
  const ok = state.downloadQueue.filter((x) => x.status === 'done').length
  toast(`下载完成：成功 ${ok} 首${failed ? `，失败 ${failed} 首（可在存储页重试）` : ''}`, failed ? 'error' : 'success')
}

/** 重试失败项（只重跑失败清单） */
export async function retryFailedDownloads() {
  const failed = state.downloadQueue.filter((x) => x.status === 'failed')
  if (!failed.length) return
  for (const item of failed) {
    // 清掉失败索引，允许重下
    if (state.downloads[item.key]?.status === 'failed') {
      const next = { ...state.downloads }
      delete next[item.key]
      state.downloads = next
      persistIndex('bmp:downloads', state.downloads)
    }
    item.status = 'pending'
  }
  toast(`重试 ${failed.length} 首…`, 'info')
  await runQueue()
}

/** 删除单个下载（文件 + 索引） */
export async function removeDownload(song, { confirm = true } = {}) {
  const rec = downloadOf(song)
  if (!rec) return false
  if (confirm) {
    const ok = await askConfirm({
      title: '删除下载',
      message: `将删除本地文件《${rec.song?.name || ''}》（${formatBytes(rec.size)}），需要时可重新下载。`,
      confirmText: '删除',
      danger: true,
    })
    if (!ok) return false
  }
  try {
    await downloadBackend()?.removeDownloadedFile?.(rec.key, rec.ext)
  } catch {
    /* 文件可能已不存在 */
  }
  const next = { ...state.downloads }
  delete next[rec.key]
  state.downloads = next
  persistIndex('bmp:downloads', state.downloads)
  return true
}

/** 清空全部下载 */
export async function clearAllDownloads() {
  const count = Object.keys(state.downloads).length
  if (!count) return
  const ok = await askConfirm({
    title: '清空下载',
    message: `将删除全部 ${count} 首已下载歌曲，需要时可重新下载。`,
    confirmText: '清空',
    danger: true,
  })
  if (!ok) return
  try {
    await downloadBackend()?.clearDir?.(downloadBackend()?.dirs?.DOWNLOAD_DIR)
  } catch {
    /* 忽略 */
  }
  state.downloads = {}
  state.downloadQueue = []
  persistIndex('bmp:downloads', state.downloads)
  toast('已清空下载', 'success')
}

// ── 本地音乐导入（P6.4） ────────────────────────────────────────────────

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('读取文件失败'))
    reader.onload = () => {
      const s = String(reader.result || '')
      resolve(s.includes(',') ? s.slice(s.indexOf(',') + 1) : s)
    }
    reader.readAsDataURL(file)
  })
}

/** 导入本地文件（<input type=file> 的 File 列表） */
export async function importLocalFiles(files) {
  if (!hasDownloads()) {
    toast('当前环境不支持导入本地音乐（仅 App）', 'error')
    return 0
  }
  const list = Array.from(files || [])
  if (!list.length) return 0
  let ok = 0
  for (const file of list) {
    try {
      const key = `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
      const ext = extFromFileName(file.name)
      const data = await fileToBase64(file)
      const { path, uri } = await downloadBackend().writeLocalMusic({ key, ext, data })
      const { name, singers } = parseLocalFileName(file.name)
      state.localMusic = [
        ...state.localMusic,
        { key, name, singers, path, uri, ext, size: file.size || 0, createdAt: Date.now() },
      ]
      ok += 1
    } catch (e) {
      toast(`导入失败：${file.name}（${e?.message || '未知错误'}）`, 'error')
    }
  }
  persistIndex('bmp:local-music', state.localMusic)
  if (ok) toast(`已导入 ${ok} 首本地音乐`, 'success')
  return ok
}

/** 删除本地音乐（文件 + 索引） */
export async function removeLocalMusic(item) {
  if (!item) return false
  const ok = await askConfirm({
    title: '删除本地音乐',
    message: `将从应用内移除《${item.name}》（不会删除原文件所在位置的文件）。`,
    confirmText: '移除',
    danger: true,
  })
  if (!ok) return false
  try {
    await downloadBackend()?.removeLocalMusic?.(item.key, item.ext)
  } catch {
    /* 忽略 */
  }
  state.localMusic = state.localMusic.filter((x) => x.key !== item.key)
  persistIndex('bmp:local-music', state.localMusic)
  return true
}

/** 本地音乐 → 可播放歌曲数组（带 localUri，播放器直接播本地文件） */
export function localMusicSongs() {
  return state.localMusic.map((m) => ({
    id: m.key,
    mid: '',
    name: m.name,
    singers: m.singers || [],
    album: '本地音乐',
    albumMid: '',
    cover: '',
    interval: 0,
    localUri: m.uri,
    downloaded: true,
  }))
}
