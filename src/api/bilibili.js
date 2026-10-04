import { signWbi } from './wbi.js'
import { httpRequest, resolveAudioUrl } from '../core/http.js'

let buvidCache = null

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 解码 B 站标题里的 HTML 实体（含 &#x27; 这类数字实体） */
function decodeEntities(str) {
  return String(str || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => {
      try {
        return String.fromCodePoint(parseInt(h, 16))
      } catch {
        return ''
      }
    })
    .replace(/&#(\d+);/g, (_, d) => {
      try {
        return String.fromCodePoint(Number(d))
      } catch {
        return ''
      }
    })
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    // &amp; 放最后，避免二次解码
    .replace(/&amp;/g, '&')
}

export function stripHtml(str) {
  return decodeEntities(String(str || '').replace(/<[^>]+>/g, '')).trim()
}

function normalizeCover(url) {
  if (!url) return ''
  return url.startsWith('//') ? `https:${url}` : url
}

async function getBuvid() {
  if (buvidCache) return buvidCache
  try {
    const res = await httpRequest('/bili-api/x/frontend/finger/spi', { label: 'B 站' })
    const json = await res.json()
    if (json.code === 0 && json.data?.b_3) {
      buvidCache = json.data.b_3
    }
  } catch {
    /* 忽略，无 buvid 多数情况也能搜索 */
  }
  return buvidCache
}

function cookieHeader(userCookie) {
  const parts = []
  if (buvidCache) parts.push(`buvid3=${buvidCache}`)
  if (userCookie) parts.push(userCookie.replace(/^\s*cookie:\s*/i, '').trim())
  return parts.join('; ')
}

async function biliFetchRaw(path, userCookie, timeout = 8000) {
  await getBuvid()
  const res = await httpRequest(`/bili-api${path}`, {
    headers: { 'X-Bili-Cookie': cookieHeader(userCookie) },
    timeout,
    label: 'B 站',
  })
  const text = await res.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    json = null
  }
  return { status: res.status, ok: res.ok, json, text: text.slice(0, 200) }
}

function mapResults(json) {
  const list = json.data?.result || []
  return list
    .filter((v) => v.type === 'video' && v.bvid)
    .map((v) => ({
      bvid: v.bvid,
      title: stripHtml(v.title),
      author: v.author || '',
      play: v.play || 0,
      danmaku: v.danmaku || 0,
      duration: v.duration || '',
      cover: normalizeCover(v.pic),
      pubdate: v.pubdate || 0,
      url: `https://www.bilibili.com/video/${v.bvid}`,
    }))
}

/**
 * 关键词搜索视频。批量匹配时 B 站容易限流（HTTP 500 / -412），
 * 因此这里自带重试 + 退避，且每次重试都重新签名（wts 需要新鲜）。
 */
export async function searchVideo(keyword, userCookie, page = 1) {
  let lastErr = null
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const query = await signWbi({ search_type: 'video', keyword, page })
      const { ok, status, json, text } = await biliFetchRaw(
        `/x/web-interface/wbi/search/type?${query}`,
        userCookie
      )
      if (!ok || !json) {
        throw new Error(`B 站接口请求失败 (${status})${text ? ` ${text}` : ''}`)
      }
      if (json.code === -412) {
        throw new Error('B 站触发风控(-412)')
      }
      if (json.code !== 0) {
        throw new Error(json.message || `B 站搜索失败(${json.code})`)
      }
      return mapResults(json)
    } catch (e) {
      lastErr = e
      if (attempt < 2) await sleep(700 * (attempt + 1))
    }
  }
  throw lastErr || new Error('B 站搜索失败')
}

/** 内嵌播放地址；startSec > 0 时带 t= 从指定秒开始（iframe 兜底音源的定位用） */
export function playerUrl(bvid, page = 1, startSec = 0) {
  const start = Math.floor(Number(startSec) || 0)
  const t = start > 0 ? `&t=${start}` : ''
  return `https://player.bilibili.com/player.html?bvid=${bvid}&page=${page}&high_quality=1&danmaku=0&autoplay=1${t}`
}

async function fetchPlayurl(bvid, cid, fnval, userCookie) {
  const query = await signWbi({ bvid, cid, fnval, fnver: 0, fourk: 1 })
  const pr = await biliFetchRaw(`/x/player/wbi/playurl?${query}`, userCookie)
  if (pr.json?.code !== 0) throw new Error(pr.json?.message || `playurl 返回 ${pr.json?.code}`)
  return pr.json.data || {}
}

/** 可代理的 B站官方/CDN 域名（与 server/image-proxy.js 的 MEDIA_ALLOW 保持一致） */
const MIRROR_ALLOW = /\.(bilivideo\.com|bilivideo\.cn|akamaized\.net|hdslb\.com|acgvideo\.com)$/i

function isMirror(url) {
  try {
    return MIRROR_ALLOW.test(new URL(url).hostname)
  } catch {
    return false
  }
}

/** 优先挑选白名单镜像（内容相同），避免拿到 PCDN 第三方域名 */
function pickPreferred(candidates) {
  const list = (candidates || []).filter(Boolean)
  return list.find(isMirror) || list[0] || ''
}

/**
 * 取 B 站视频的音频流，返回可直接喂给 <audio> 的同源代理地址。
 * 有了真正的音频流，进度条就能拖动、也能精确判断播放结束。
 * 优先 DASH 纯音轨；部分视频只有普通 MP4/FLV，则回退 durl（浏览器播其音轨）。
 */
export async function fetchBiliAudio(bvid, userCookie) {
  if (!bvid) throw new Error('缺少 bvid')
  const pl = await biliFetchRaw(`/x/player/pagelist?bvid=${bvid}`, userCookie)
  const cid = pl.json?.data?.[0]?.cid
  if (!cid) throw new Error('无法获取视频 cid')

  let raw = ''

  // 1) DASH 纯音频（优先官方镜像）
  try {
    const data = await fetchPlayurl(bvid, cid, 16, userCookie)
    const audios = data.dash?.audio || []
    if (audios.length) {
      const best = [...audios].sort((a, b) => (b.bandwidth || 0) - (a.bandwidth || 0))[0]
      raw = pickPreferred([best.baseUrl, best.baseUrl64, ...(best.backupUrl || [])])
    }
  } catch {
    /* 继续尝试 durl */
  }

  // 2) 回退：普通 MP4（跳过 FLV，<audio> 不支持）
  if (!raw || !isMirror(raw)) {
    try {
      const data = await fetchPlayurl(bvid, cid, 1, userCookie)
      const durl = data.durl || []
      const mp4 = durl
        .flatMap((d) => [d.url, ...(d.backup_url || [])])
        .filter((u) => u && !/\.flv(\?|$)/i.test(u))
      const picked = pickPreferred(mp4)
      if (picked) raw = picked
    } catch {
      /* 保留已有的 raw（若有） */
    }
  }

  if (!raw) throw new Error('该视频没有可用的音频流')
  if (!isMirror(raw)) throw new Error('该视频音源仅提供第三方 PCDN，不可代理（已回退内嵌播放）')
  // 移动端会先下载到本地再返回（Promise），Web 端同步返回代理地址
  return await resolveAudioUrl(raw)
}
