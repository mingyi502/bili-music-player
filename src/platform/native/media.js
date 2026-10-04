/**
 * 移动端媒体适配层。
 *
 * 图片：B站封面有防盗链，WebView 直连会 403；用原生 HTTP 带 Referer 取回，
 *       转成 blob: URL 交给 <img>（内存缓存由 utils/mediaCache 去重）。
 * 音频：B站音频流同样校验 Referer，且需要随机访问（拖动进度），
 *       因此下载到 Cache 目录后用 Capacitor.convertFileSrc() 交给 <audio>。
 *
 * 通过依赖注入接收插件，纯逻辑（缓存键、扩展名、失败回退）可单测。
 */
import { USER_AGENT, refererForHost } from '../../core/upstreams.js'
import { base64ToBlob, headerOf } from './base64.js'

const REFERER = 'https://www.bilibili.com/'
const AUDIO_DIR = 'bmp-audio'
/** 下载（持久）与本地音乐目录（Directory.Data，不随系统清理 Cache） */
const DOWNLOAD_DIR = 'bmp-downloads'
const LOCAL_DIR = 'bmp-local-music'
/** 导出文件目录（Directory.External，应用专属，无需权限） */
const EXPORT_DIR = 'bmp-exports'
// 缓存不足 1KB 视为残留的半截文件，重新下载
const MIN_AUDIO_BYTES = 1024

/** 按域名选择 Referer：B站图片要 B站 Referer，QQ 图片要 QQ Referer，其它不带 */
export function refererFor(url) {
  return refererForHost(url)?.referer || ''
}

/** FNV-1a：稳定、短、无依赖，用于给音频 URL 生成缓存文件名 */
export function cacheKey(url) {
  let h = 0x811c9dc5
  for (let i = 0; i < url.length; i++) {
    h ^= url.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

/** 从 URL 里取扩展名（B站 DASH 音频是 .m4s），取不到就按 m4s 处理 */
export function extFromUrl(url) {
  try {
    const m = new URL(url).pathname.match(/\.([a-z0-9]{2,5})$/i)
    return m ? `.${m[1].toLowerCase()}` : '.m4s'
  } catch {
    return '.m4s'
  }
}

/**
 * @param {object} deps
 * @param {object} deps.CapacitorHttp   原生 HTTP
 * @param {object} deps.Filesystem      @capacitor/filesystem
 * @param {object} deps.Directory       Directory 枚举
 * @param {object} deps.FileTransfer    @capacitor/file-transfer
 * @param {object} deps.Capacitor       用于 convertFileSrc
 */
export function createNativeMedia({ CapacitorHttp, Filesystem, Directory, FileTransfer, Capacitor } = {}) {
  if (!CapacitorHttp || !Filesystem || !FileTransfer || !Capacitor) {
    throw new Error('createNativeMedia 缺少依赖')
  }

  let dirReady = null

  /** 确保缓存目录存在（只需一次） */
  function ensureDir() {
    if (!dirReady) {
      dirReady = Filesystem.mkdir({ path: AUDIO_DIR, directory: Directory.Cache, recursive: true }).catch(() => {})
    }
    return dirReady
  }

  /** 图片：带对应域名的 Referer 取回后转 blob URL（取不到则抛错，由上层回退直连） */
  async function resolveImage(url) {
    // Android 默认禁止明文流量，图片地址统一升级为 https（QQ/B站图片域名都支持）
    const target = String(url).replace(/^http:\/\//i, 'https://')
    const referer = refererFor(target)
    const headers = { 'User-Agent': USER_AGENT }
    if (referer) headers.Referer = referer
    const res = await CapacitorHttp.request({ url: target, headers, responseType: 'blob' })
    if (res.status < 200 || res.status >= 300) throw new Error(`图片请求失败 (${res.status})`)
    // responseType=blob 时 CapacitorHttp 返回 base64 字符串，需要自己转成 Blob
    const mime = headerOf(res.headers, 'content-type') || 'image/jpeg'
    const blob = res.data instanceof Blob ? res.data : base64ToBlob(String(res.data ?? ''), mime)
    return URL.createObjectURL(blob)
  }

  /** 音频：下载到 Cache 目录（命中缓存则直接播放），返回可被 <audio> 使用的地址 */
  async function resolveAudio(url) {
    await ensureDir()
    const path = `${AUDIO_DIR}/${cacheKey(url)}${extFromUrl(url)}`
    const { uri } = await Filesystem.getUri({ path, directory: Directory.Cache })

    // 命中缓存：体积正常就直接用
    try {
      const info = await Filesystem.stat({ path, directory: Directory.Cache })
      if (info?.size >= MIN_AUDIO_BYTES) return Capacitor.convertFileSrc(uri)
    } catch {
      /* 未缓存，继续下载 */
    }

    await FileTransfer.downloadFile({
      url,
      path: uri,
      // QQ 音频 CDN 要 QQ Referer，B站镜像要 B站 Referer（未命中域名保持原行为）
      headers: { 'User-Agent': USER_AGENT, Referer: refererFor(url) || REFERER },
      connectTimeout: 15000,
      readTimeout: 60000,
    })
    return Capacitor.convertFileSrc(uri)
  }

  /** 清理音频磁盘缓存（设置页可调用；Cache 目录本身也可能被系统回收） */
  async function clearAudioCache() {
    try {
      await Filesystem.rmdir({ path: AUDIO_DIR, directory: Directory.Cache, recursive: true })
    } catch {
      /* 目录不存在时忽略 */
    }
    dirReady = null
  }

  // ── P6 下载与本地音乐（持久目录 Directory.Data） ─────────────────────────

  function ensureDataDir(dir) {
    return Filesystem.mkdir({ path: dir, directory: Directory.Data, recursive: true }).catch(() => {})
  }

  /**
   * 下载单曲到持久目录（不随 Cache 清理）。
   * @param {{ url:string, key:string, onProgress?:(ratio:number)=>void }} opts
   * @returns {Promise<{ path:string, ext:string, uri:string, size:number }>}
   */
  async function downloadAudio({ url, key, onProgress }) {
    if (!url || !key) throw new Error('下载缺少参数')
    await ensureDataDir(DOWNLOAD_DIR)
    const ext = extFromUrl(url)
    const path = `${DOWNLOAD_DIR}/${key}${ext}`
    const { uri } = await Filesystem.getUri({ path, directory: Directory.Data })
    let listener = null
    if (onProgress && typeof FileTransfer.addListener === 'function') {
      try {
        listener = await FileTransfer.addListener('progress', (ev) => {
          if (ev?.url && String(ev.url) !== String(url)) return
          const total = Number(ev?.contentLength) || 0
          if (total > 0) onProgress(Math.min(1, (Number(ev.bytes) || 0) / total))
        })
      } catch {
        /* 无进度事件不影响下载 */
      }
    }
    try {
      await FileTransfer.downloadFile({
        url,
        path: uri,
        progress: !!onProgress,
        headers: { 'User-Agent': USER_AGENT, Referer: refererFor(url) || REFERER },
        connectTimeout: 15000,
        readTimeout: 120000,
      })
    } finally {
      try {
        await listener?.remove?.()
      } catch {
        /* 忽略 */
      }
    }
    const info = await Filesystem.stat({ path, directory: Directory.Data }).catch(() => null)
    return { path, ext, uri: Capacitor.convertFileSrc(uri), size: Number(info?.size) || 0 }
  }

  /** 已下载文件是否仍存在（清理/重装后索引可能失效） */
  async function downloadedFileInfo(key, ext) {
    try {
      const path = `${DOWNLOAD_DIR}/${key}${ext || ''}`
      const info = await Filesystem.stat({ path, directory: Directory.Data })
      const { uri } = await Filesystem.getUri({ path, directory: Directory.Data })
      return { exists: true, size: Number(info?.size) || 0, uri: Capacitor.convertFileSrc(uri) }
    } catch {
      return { exists: false }
    }
  }

  /** 删除单个下载文件 */
  async function removeDownloadedFile(key, ext) {
    try {
      await Filesystem.deleteFile({ path: `${DOWNLOAD_DIR}/${key}${ext || ''}`, directory: Directory.Data })
    } catch {
      /* 不存在时忽略 */
    }
  }

  /** 目录递归占用（不存在返回 0） */
  async function dirSize(dir, directory = Directory.Data) {
    try {
      const { files } = await Filesystem.readdir({ path: dir, directory })
      let total = 0
      for (const f of files) {
        if (f.type === 'directory') total += await dirSize(`${dir}/${f.name}`, directory)
        else total += Number(f.size) || 0
      }
      return total
    } catch {
      return 0
    }
  }

  /** 清空目录（下载 / 本地音乐 / 音频缓存） */
  async function clearDir(dir, directory = Directory.Data) {
    try {
      await Filesystem.rmdir({ path: dir, directory, recursive: true })
    } catch {
      /* 不存在时忽略 */
    }
  }

  /** 写入本地音乐文件（base64 数据） */
  async function writeLocalMusic({ key, ext, data }) {
    await ensureDataDir(LOCAL_DIR)
    const path = `${LOCAL_DIR}/${key}${ext}`
    await Filesystem.writeFile({ path, data, directory: Directory.Data, recursive: true })
    const { uri } = await Filesystem.getUri({ path, directory: Directory.Data })
    return { path, uri: Capacitor.convertFileSrc(uri) }
  }

  /** 删除本地音乐文件 */
  async function removeLocalMusic(key, ext) {
    try {
      await Filesystem.deleteFile({ path: `${LOCAL_DIR}/${key}${ext || ''}`, directory: Directory.Data })
    } catch {
      /* 不存在时忽略 */
    }
  }

  // ── P7.4 G5：文本导出（Directory.External 应用专属目录，无需存储权限） ────

  async function saveTextFile(fileName, text) {
    await Filesystem.mkdir({ path: EXPORT_DIR, directory: Directory.External, recursive: true }).catch(() => {})
    const path = `${EXPORT_DIR}/${fileName}`
    // 注意：Capacitor writeFile 的字符串 data 默认按 base64 解码，文本必须显式声明 utf8
    await Filesystem.writeFile({ path, data: String(text ?? ''), directory: Directory.External, encoding: 'utf8', recursive: true })
    const { uri } = await Filesystem.getUri({ path, directory: Directory.External })
    const info = await Filesystem.stat({ path, directory: Directory.External }).catch(() => null)
    return { path, uri: Capacitor.convertFileSrc(uri), size: Number(info?.size) || 0, dir: EXPORT_DIR }
  }

  return {
    resolveImage,
    resolveAudio,
    clearAudioCache,
    downloadAudio,
    downloadedFileInfo,
    removeDownloadedFile,
    dirSize,
    clearDir,
    writeLocalMusic,
    removeLocalMusic,
    saveTextFile,
    dirs: { AUDIO_DIR, DOWNLOAD_DIR, LOCAL_DIR, EXPORT_DIR },
    Directory,
  }
}
