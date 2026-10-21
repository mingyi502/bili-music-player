/**
 * 图片异步解析缓存。
 *
 * Web：无需异步——沿用 /img-api 代理，同步返回。
 * 移动端：B站封面有防盗链，WebView 的 Referer 是 localhost 会被拒，
 *         因此必须由原生层带 Referer 取回，再转成 blob: URL。
 *
 * 对外提供 useImage(url)：返回一个 ref，先给占位值，解析完成后自动更新。
 */
import { ref, watch } from 'vue'
import { resolveImageUrl } from '../core/http.js'
import { IMAGE_PROXY_HOST } from '../core/upstreams.js'

/** 平台侧注入异步解析器：(url) => Promise<string> */
let asyncResolver = null

export function setImageResolver(fn) {
  asyncResolver = fn
}

/** Web 端：仅 B站封面需要代理（防盗链），其它地址直连 */
function webImageUrl(url) {
  return IMAGE_PROXY_HOST.test(url) ? resolveImageUrl(url) : url
}

/** 统一把 http:// 升级为 https://（Android 禁止明文流量；QQ 图片域名也支持 https） */
export function httpsify(url) {
  if (!url) return ''
  const s = String(url)
  return s.startsWith('//') ? `https:${s}` : s.replace(/^http:\/\//i, 'https://')
}

// 已解析结果：url -> 可显示地址（blob: 或代理地址）
const resolved = new Map()
// 进行中的请求，避免同一张图重复下载
const inflight = new Map()
// 「我喜欢」最多可一次渲染 600+ 行；缓存过小会在滚动/进入歌单时淘汰并 revoke
// 仍在页面上的 blob URL，表现为整列封面变成裂图。留足一个大型歌单的余量。
const MAX_ENTRIES = 1200
// 原生解析器返回的 blob: URL 由本模块拥有，淘汰时主动释放底层 Blob。
const ownedObjectUrls = new Set()
let cacheGeneration = 0

function revokeObjectUrl(value) {
  if (!ownedObjectUrls.has(value)) return
  ownedObjectUrls.delete(value)
  try {
    URL.revokeObjectURL(value)
  } catch {
    /* 部分 WebView 没有 revokeObjectURL，忽略即可 */
  }
}

function remember(url, value) {
  const previous = resolved.get(url)
  if (previous && previous !== value) revokeObjectUrl(previous)
  if (resolved.size >= MAX_ENTRIES) {
    const oldest = resolved.keys().next().value
    revokeObjectUrl(resolved.get(oldest))
    resolved.delete(oldest)
  }
  if (typeof value === 'string' && value.startsWith('blob:')) ownedObjectUrls.add(value)
  resolved.set(url, value)
}

/** 解析一张图片地址。 */
export function resolveImage(url) {
  if (!url) return Promise.resolve('')
  url = httpsify(url)
  if (!asyncResolver) return Promise.resolve(webImageUrl(url))
  if (resolved.has(url)) return Promise.resolve(resolved.get(url))
  if (inflight.has(url)) return inflight.get(url)
  const generation = cacheGeneration

  const task = (async () => {
    try {
      const value = await asyncResolver(url)
      if (generation === cacheGeneration) remember(url, value || '')
      else revokeObjectUrl(value)
      return value || ''
    } catch {
      if (generation === cacheGeneration) remember(url, url)
      return url
    } finally {
      inflight.delete(url)
    }
  })()
  inflight.set(url, task)
  return task
}

/** 组件用：给一个原始地址，返回可绑定的响应式地址。 */
export function useImage(source) {
  const raw = typeof source === 'function' ? source : () => source
  const current = ref('')
  let token = 0

  const load = (value) => {
    const mine = ++token
    if (!value) {
      current.value = ''
      return
    }
    const url = httpsify(value)
    const cached = resolved.get(url)
    if (cached !== undefined) {
      current.value = cached
      return
    }
    if (!asyncResolver) {
      current.value = webImageUrl(url)
      return
    }
    current.value = ''
    resolveImage(url).then((result) => {
      if (mine === token) current.value = result
    })
  }

  watch(raw, load, { immediate: true })
  return current
}

/** 清空解析缓存（登出/切换账号时调用） */
export function clearImageCache() {
  cacheGeneration++
  for (const value of resolved.values()) revokeObjectUrl(value)
  resolved.clear()
  inflight.clear()
}
