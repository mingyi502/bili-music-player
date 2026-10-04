/**
 * Node 侧的 QQ 扫码登录中间件（/auth-api/*）。
 *
 * 业务流程已抽到平台无关的 src/core/qqLogin.js；这里只做三件事：
 *   1. 提供 Node(undici) 的 transport（可手动跟随 302、可读取 Set-Cookie）
 *   2. 维护服务端会话 + 定期清理
 *   3. 暴露 connect 中间件给 Vite 开发服务器
 */
import { createQqLogin } from '../src/core/qqLogin.js'

// 兜底：避免任何未处理异常把开发服务器弄崩（否则页面还开着，但所有接口都会 Failed to fetch）
if (typeof process !== 'undefined' && !globalThis.__qqLoginGuards) {
  globalThis.__qqLoginGuards = true
  process.on('unhandledRejection', (reason) => {
    console.error('[qq-login] 未处理的 Promise 拒绝:', reason)
  })
  process.on('uncaughtException', (err) => {
    console.error('[qq-login] 未捕获异常（已忽略，服务继续运行）:', err)
  })
}

const SESSION_COOKIE = 'qqauth_sid'

// 详细日志默认关闭：其中可能包含含 uin/ptsigx 的登录 URL 与 Cookie 名。
// 需要排障时用 `QQ_DEBUG=1 npm run dev` 打开。
const DEBUG = /^(1|true)$/i.test(process.env.QQ_DEBUG || '')

/** Node(undici) transport：手动跟随重定向由核心控制，这里只负责发出请求 */
export async function nodeTransport({ url, method = 'GET', headers, body, timeout = 15000 }) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  try {
    return await fetch(url, { method, redirect: 'manual', headers, body, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

const login = createQqLogin({
  transport: nodeTransport,
  log: (step, data) => {
    if (!DEBUG) return
    console.log(`[qq-login] ${step}`, data === undefined ? '' : data)
  },
})

// 定期清理过期会话，避免反复刷新二维码导致内存无限增长
const sweeper = setInterval(() => login.sweep(), 60 * 1000)
if (typeof sweeper.unref === 'function') sweeper.unref()

export const { startLogin, pollLogin, closeSession } = login
export { hash33, getGtk } from '../src/core/qqLogin.js'

function readSid(req) {
  const raw = req.headers.cookie || ''
  const m = raw.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`))
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

/** Vite / connect 中间件：/auth-api/* */
export function qqAuthMiddleware(req, res, next) {
  const url = new URL(req.url, 'http://localhost')
  if (!url.pathname.startsWith('/auth-api')) return next()

  const run = async () => {
    if (url.pathname === '/auth-api/ping' && req.method === 'GET') {
      return sendJson(res, 200, { ok: true, time: Date.now() })
    }
    if (url.pathname === '/auth-api/qr/start' && req.method === 'POST') {
      const { sid, image } = await startLogin()
      return sendJson(res, 200, { ok: true, image }, {
        'Set-Cookie': `${SESSION_COOKIE}=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=900`,
      })
    }
    if (url.pathname === '/auth-api/qr/poll' && req.method === 'GET') {
      const sid = readSid(req)
      if (!sid) return sendJson(res, 200, { status: 'expired', message: '会话不存在，请刷新二维码' })
      return sendJson(res, 200, await pollLogin(sid))
    }
    if (url.pathname === '/auth-api/session/close' && req.method === 'POST') {
      closeSession(readSid(req))
      return sendJson(res, 200, { ok: true }, {
        'Set-Cookie': `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
      })
    }
    return sendJson(res, 404, { ok: false, error: 'Not Found' })
  }

  run().catch((e) => sendJson(res, 500, { status: 'error', message: e?.message || '服务端异常' }))
}
