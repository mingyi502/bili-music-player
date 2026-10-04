import { Readable } from 'node:stream'
import {
  USER_AGENT as UA,
  IMAGE_HOST_ALLOW as ALLOW,
  MEDIA_HOST_ALLOW as MEDIA_ALLOW,
  refererForHost,
} from '../src/core/upstreams.js'

/**
 * /img-api?url=<encoded>
 * B 站图片有防盗链，浏览器直连会裂图；这里在服务端带上正确 Referer 取图再回传。
 */
export function imageProxyMiddleware(req, res, next) {
  const url = new URL(req.url, 'http://localhost')
  if (!url.pathname.startsWith('/img-api')) return next()

  const target = url.searchParams.get('url')
  if (!target) {
    res.writeHead(400, { 'Content-Type': 'text/plain' })
    return res.end('missing url')
  }

  let parsed
  try {
    parsed = new URL(target)
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain' })
    return res.end('bad url')
  }

  if (!/^https?:$/.test(parsed.protocol) || !ALLOW.test(parsed.hostname)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' })
    return res.end('host not allowed')
  }

  ;(async () => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 12000)
    try {
      // 手动跟随重定向，并对每一跳重新校验域名，避免被开放重定向当成跳板
      let current = parsed
      let upstream = null
      for (let hop = 0; hop < 4; hop++) {
        const ref = refererForHost(current.href)
        upstream = await fetch(current.href, {
          redirect: 'manual',
          headers: {
            'User-Agent': UA,
            Referer: ref?.referer || 'https://www.bilibili.com/',
            Accept: 'image/avif,image/webp,image/*,*/*;q=0.8',
          },
          signal: controller.signal,
        })
        const loc = upstream.headers.get('location')
        if (upstream.status >= 300 && upstream.status < 400 && loc) {
          const next = new URL(loc, current.href)
          if (!/^https?:$/.test(next.protocol) || !ALLOW.test(next.hostname)) {
            res.writeHead(403, { 'Content-Type': 'text/plain' })
            return res.end('redirect host not allowed')
          }
          current = next
          continue
        }
        break
      }
      if (!upstream || !upstream.ok) {
        res.writeHead(upstream ? upstream.status : 502)
        return res.end()
      }
      const type = upstream.headers.get('content-type') || ''
      // 只允许图片类型，防止把 HTML 透传到同源（DOM XSS）
      if (!/^image\//i.test(type)) {
        res.writeHead(502, { 'Content-Type': 'text/plain' })
        return res.end('upstream is not an image')
      }
      const buf = Buffer.from(await upstream.arrayBuffer())
      res.writeHead(200, {
        'Content-Type': type,
        'Content-Length': buf.length,
        'Cache-Control': 'public, max-age=86400',
      })
      res.end(buf)
    } catch {
      res.writeHead(502, { 'Content-Type': 'text/plain' })
      res.end('proxy error')
    } finally {
      clearTimeout(timer)
    }
  })()
}

/**
 * /media-api?url=<encoded>
 * 代理 B 站音频流（带正确的 Referer，并透传 Range 以支持进度拖动）。
 * <audio> 无法设置 Referer，且音频 token 与请求 IP 绑定，所以必须服务端中转。
 */
export function mediaProxyMiddleware(req, res, next) {
  const url = new URL(req.url, 'http://localhost')
  if (!url.pathname.startsWith('/media-api')) return next()

  const target = url.searchParams.get('url')
  if (!target) {
    res.writeHead(400, { 'Content-Type': 'text/plain' })
    return res.end('missing url')
  }

  let parsed
  try {
    parsed = new URL(target)
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain' })
    return res.end('bad url')
  }

  if (!/^https?:$/.test(parsed.protocol) || !MEDIA_ALLOW.test(parsed.hostname)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' })
    return res.end('host not allowed')
  }

  ;(async () => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 25000)
    // 客户端断开时中止上游请求；这里必须吞掉 abort 造成的异常，否则会变成未捕获异常
    res.on('close', () => {
      try {
        controller.abort()
      } catch {
        /* ignore */
      }
    })
    res.on('error', () => {})
    try {
      // 手动跟随重定向并逐跳复核白名单，避免白名单 URL 借助开放重定向变成 SSRF。
      let current = parsed
      let upstream = null
      for (let hop = 0; hop < 4; hop++) {
        if (!MEDIA_ALLOW.test(current.hostname)) {
          if (!res.headersSent) res.writeHead(403, { 'Content-Type': 'text/plain' })
          return res.end('redirect host not allowed')
        }
        const ref = refererForHost(current.href)
        const headers = {
          'User-Agent': UA,
          Referer: ref?.referer || 'https://www.bilibili.com/',
          Origin: ref?.origin || 'https://www.bilibili.com',
          Accept: '*/*',
        }
        if (req.headers.range) headers.Range = req.headers.range
        upstream = await fetch(current.href, { headers, signal: controller.signal, redirect: 'manual' })
        const location = upstream.headers.get('location')
        if (!(upstream.status >= 300 && upstream.status < 400 && location)) break
        const next = new URL(location, current.href)
        if (!/^https?:$/.test(next.protocol) || !MEDIA_ALLOW.test(next.hostname)) {
          if (!res.headersSent) res.writeHead(403, { 'Content-Type': 'text/plain' })
          return res.end('redirect host not allowed')
        }
        current = next
      }
      if (upstream?.status >= 300 && upstream?.status < 400) {
        if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain' })
        return res.end('too many redirects')
      }

      const out = {
        'Content-Type': upstream.headers.get('content-type') || 'audio/mp4',
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-store',
      }
      const len = upstream.headers.get('content-length')
      if (len) out['Content-Length'] = len
      const cr = upstream.headers.get('content-range')
      if (cr) out['Content-Range'] = cr

      if (res.writableEnded || res.destroyed) return
      res.writeHead(upstream.status, out)
      if (!upstream.body) return res.end()
      const nodeStream = Readable.fromWeb(upstream.body)
      nodeStream.on('error', () => {
        try {
          res.end()
        } catch {
          /* ignore */
        }
      })
      nodeStream.pipe(res)
    } catch {
      if (!res.headersSent && !res.writableEnded) {
        res.writeHead(502, { 'Content-Type': 'text/plain' })
      }
      try {
        res.end()
      } catch {
        /* ignore */
      }
    } finally {
      clearTimeout(timer)
    }
  })()
}
