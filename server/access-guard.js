import crypto from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'

/**
 * 局域网访问守卫。
 *
 * 背景：本项目内置的代理/中间件（/qq-api、/qqmu-api、/bili-api、/img-api、/media-api、
 * /auth-api）**没有业务鉴权**。默认服务只绑定 127.0.0.1，因此外人碰不到；一旦为了手机
 * 访问而绑定局域网，就必须加一道口令，否则同网段任何人都能拿它当开放代理。
 *
 * 规则：
 *  - 默认（未提供 accessCode）→ 完全放行，保持原有的“仅本机”行为不变
 *  - 提供 accessCode 后 → 本机(loopback)仍放行；其他来源必须携带有效访问 Cookie
 *  - forceToken=true → 连本机也要求口令（仅用于自动化测试）
 *  - /auth-api/ping 永远放行（客户端靠它判断是否需要解锁）
 *  - /auth-api/unlock 用于提交口令换取 HttpOnly Cookie
 */

const ACCESS_COOKIE = 'bmp_access'
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 天
const MAX_ATTEMPTS = 5
const WINDOW_MS = 60 * 1000
// 已授权令牌落盘，这样重启服务后手机不用重新输口令（文件已 gitignore）
const SESSION_FILE = process.env.BMP_SESSION_FILE || '.bmp-sessions.json'

export const PROTECTED_PREFIXES = ['/qq-api', '/qqmu-api', '/bili-api', '/img-api', '/media-api', '/auth-api']
export const OPEN_PATHS = ['/auth-api/ping', '/auth-api/unlock']

function isLoopback(ip) {
  const v = String(ip || '')
  return v === '127.0.0.1' || v === '::1' || v === '::ffff:127.0.0.1'
}

function safeEqual(a, b) {
  const ab = Buffer.from(String(a) || '', 'utf8')
  const bb = Buffer.from(String(b) || '', 'utf8')
  if (ab.length !== bb.length) return false
  try {
    return crypto.timingSafeEqual(ab, bb)
  } catch {
    return false
  }
}

function readCookie(req, name) {
  const raw = req.headers.cookie || ''
  const m = raw.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`))
  return m ? m[1] : ''
}

function sendJson(res, status, payload, extraHeaders = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extraHeaders,
  })
  res.end(JSON.stringify(payload))
}

function readBody(req, limit = 4096) {
  return new Promise((resolve) => {
    let data = ''
    req.on('data', (chunk) => {
      data += chunk
      if (data.length > limit) {
        data = ''
        req.destroy()
      }
    })
    req.on('end', () => resolve(data))
    req.on('error', () => resolve(''))
  })
}

/** 生成 6 位数字口令 */
export function generateAccessCode() {
  return String(crypto.randomInt(100000, 1000000))
}

/**
 * @param {{ accessCode?: string, forceToken?: boolean }} options
 * @returns {import('http').RequestListener}
 */
export function createAccessGuard({ accessCode = '', forceToken = false } = {}) {
  const enabled = Boolean(accessCode)
  /** @type {Map<string, number>} token -> 过期时间 */
  const sessions = new Map()
  /** @type {Map<string, { count: number, reset: number }>} ip -> 限流计数 */
  const attempts = new Map()

  if (enabled) loadSessions()

  function loadSessions() {
    try {
      const raw = readFileSync(SESSION_FILE, 'utf8')
      const list = JSON.parse(raw)
      const now = Date.now()
      for (const [token, exp] of list) {
        if (typeof token === 'string' && Number(exp) > now) sessions.set(token, Number(exp))
      }
    } catch {
      /* 文件不存在或损坏：忽略 */
    }
  }

  function saveSessions() {
    try {
      writeFileSync(SESSION_FILE, JSON.stringify([...sessions]), 'utf8')
    } catch {
      /* 写不进去也不影响本次运行 */
    }
  }

  function pruneSessions() {
    const now = Date.now()
    let changed = false
    for (const [token, exp] of sessions) {
      if (exp <= now) {
        sessions.delete(token)
        changed = true
      }
    }
    if (changed) saveSessions()
  }

  function sessionValid(req) {
    if (!enabled) return true
    pruneSessions()
    const token = readCookie(req, ACCESS_COOKIE)
    if (!token) return false
    const exp = sessions.get(token)
    return Boolean(exp && exp > Date.now())
  }

  /** 只拦受保护的接口前缀，静态资源/HTML/源码必须放行，否则解锁页都加载不出来 */
  function isProtected(pathname) {
    return PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/') || pathname.startsWith(p + '?'))
  }

  return function accessGuard(req, res, next) {
    let url
    try {
      url = new URL(req.url, 'http://localhost')
    } catch {
      return next()
    }
    const pathname = url.pathname
    if (!isProtected(pathname)) return next()

    const loopback = isLoopback(req.socket && req.socket.remoteAddress)
    const authed = sessionValid(req)

    // 客户端用它判断是否需要解锁，因此永远放行
    if (pathname === '/auth-api/ping') {
      return sendJson(res, 200, {
        ok: true,
        authRequired: enabled,
        authed: enabled ? authed : true,
        time: Date.now(),
      })
    }

    if (pathname === '/auth-api/unlock' && req.method === 'POST') {
      const ip = (req.socket && req.socket.remoteAddress) || 'unknown'
      const now = Date.now()
      const rec = attempts.get(ip) || { count: 0, reset: now + WINDOW_MS }
      if (now > rec.reset) {
        rec.count = 0
        rec.reset = now + WINDOW_MS
      }
      if (rec.count >= MAX_ATTEMPTS) {
        attempts.set(ip, rec)
        return sendJson(res, 429, { ok: false, message: '尝试次数过多，请稍后再试' })
      }
      rec.count++
      attempts.set(ip, rec)

      return readBody(req).then((body) => {
        let code = ''
        try {
          code = String(JSON.parse(body || '{}').code || '')
        } catch {
          code = ''
        }
        if (!enabled) {
          return sendJson(res, 200, { ok: true, authRequired: false })
        }
        if (!code || !safeEqual(code, accessCode)) {
          return sendJson(res, 401, { ok: false, message: '访问口令不正确' })
        }
        attempts.delete(ip)
        const token = crypto.randomBytes(24).toString('hex')
        sessions.set(token, Date.now() + SESSION_TTL_MS)
        saveSessions()
        return sendJson(res, 200, { ok: true }, {
          'Set-Cookie': `${ACCESS_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(
            SESSION_TTL_MS / 1000
          )}`,
        })
      })
    }

    if (loopback && !forceToken) return next()
    if (authed) return next()

    return sendJson(res, 401, { ok: false, authRequired: true, message: '需要访问口令' })
  }
}
