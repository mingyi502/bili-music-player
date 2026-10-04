/**
 * 下载 / 本地音乐索引（P6）：纯函数 + 统计。
 *
 * 索引持久化在 `bmp:downloads`（`{ [songKey]: record }`）与 `bmp:local-music`（数组），
 * 记录字段见 store/downloads.js；本文件只放可单测的纯逻辑。
 */

/** 字节 → 可读体积（B/KB/MB/GB，保留 1 位小数） */
export function formatBytes(n) {
  const v = Number(n) || 0
  if (v < 1024) return `${v} B`
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`
  if (v < 1024 * 1024 * 1024) return `${(v / 1024 / 1024).toFixed(1)} MB`
  return `${(v / 1024 / 1024 / 1024).toFixed(2)} GB`
}

/**
 * 本地音乐文件名 → `{ name, singers }`。
 * 支持「歌手 - 歌名.ext」「歌手-歌名.ext」，其余情况整个文件名当歌名。
 */
export function parseLocalFileName(fileName) {
  const base = String(fileName || '').trim().replace(/\.[a-z0-9]{2,5}$/i, '')
  const m = base.match(/^(.+?)\s*-\s*(.+)$/)
  if (m) {
    const singer = m[1].trim()
    const name = m[2].trim()
    if (singer && name) return { name, singers: [singer] }
  }
  return { name: base || '未知歌曲', singers: [] }
}

/** 从文件名取扩展名（小写，含点；取不到给 .mp3） */
export function extFromFileName(fileName) {
  const m = String(fileName || '').match(/\.([a-z0-9]{2,5})$/i)
  return m ? `.${m[1].toLowerCase()}` : '.mp3'
}

/**
 * 下载索引统计。
 * @param {Record<string, {status?: string, size?: number}>} index
 * @returns {{ count:number, size:number, downloading:number, failed:number, pending:number }}
 */
export function downloadStats(index) {
  const out = { count: 0, size: 0, downloading: 0, failed: 0, pending: 0 }
  for (const rec of Object.values(index || {})) {
    if (!rec) continue
    if (rec.status === 'done') {
      out.count += 1
      out.size += Number(rec.size) || 0
    } else if (rec.status === 'downloading') out.downloading += 1
    else if (rec.status === 'failed') out.failed += 1
    else if (rec.status === 'pending') out.pending += 1
  }
  return out
}

/** 下载列表 → 可播放歌曲数组（本地音乐页/离线播放复用） */
export function downloadsToSongs(index) {
  return Object.values(index || {})
    .filter((r) => r?.status === 'done' && r.uri)
    .map((r) => ({ ...(r.song || {}), name: r.song?.name || '未知歌曲', localUri: r.uri, downloaded: true }))
}
