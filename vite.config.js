import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import os from 'node:os'
import { readFileSync } from 'node:fs'
import { qqAuthMiddleware } from './server/qq-login.js'
import { imageProxyMiddleware, mediaProxyMiddleware } from './server/image-proxy.js'
import { createAccessGuard, generateAccessCode } from './server/access-guard.js'
import { UPSTREAMS, USER_AGENT } from './src/core/upstreams.js'

// 把版本号与构建时间注入前端，便于确认「页面是否已刷新到最新代码」
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
const BUILD_TIME = new Date().toISOString()

// ── 访问控制 ───────────────────────────────────────────────────────────────
// 默认：只绑 127.0.0.1，无需口令（与之前行为一致）
// BMP_LAN=1        → 绑定局域网，并自动生成一次性访问口令（打印在终端）
// BMP_ACCESS_CODE  → 指定固定口令（测试用）
// BMP_FORCE_TOKEN=1→ 连本机也要求口令（仅用于自动化测试）
const envFlag = (name) => /^(1|true)$/i.test(process.env[name] || '')
const LAN_MODE = envFlag('BMP_LAN')
const FORCE_TOKEN = envFlag('BMP_FORCE_TOKEN')
const ACCESS_CODE = process.env.BMP_ACCESS_CODE || (LAN_MODE || FORCE_TOKEN ? generateAccessCode() : '')

// 浏览器无法直接设置 Referer / Cookie，因此统一走本地代理转发并改写请求头。
// 代理规则由 src/core/upstreams.js 生成，与移动端共用同一份配置。
function upstreamProxy(prefix) {
  const cfg = UPSTREAMS[prefix]
  return {
    target: cfg.target,
    changeOrigin: true,
    rewrite: (p) => p.replace(new RegExp('^' + prefix), ''),
    configure(proxy) {
      proxy.on('proxyReq', (proxyReq, req) => {
        proxyReq.setHeader('Referer', cfg.referer)
        if (cfg.origin) proxyReq.setHeader('Origin', cfg.origin)
        proxyReq.setHeader('User-Agent', USER_AGENT)
        const ck = req.headers[cfg.cookieName]
        if (ck) proxyReq.setHeader('Cookie', ck)
      })
    },
  }
}

const PROXIES = Object.fromEntries(Object.keys(UPSTREAMS).map((prefix) => [prefix, upstreamProxy(prefix)]))

// 扫码登录需要在服务端维护 Cookie 会话，因此用中间件而非普通代理。
function qqAuth() {
  const guard = createAccessGuard({ accessCode: ACCESS_CODE, forceToken: FORCE_TOKEN })
  return {
    name: 'qq-auth',
    configureServer(server) {
      // 守卫必须最先注册，才能拦住后面的代理与中间件
      server.middlewares.use(guard)
      server.middlewares.use(qqAuthMiddleware)
      server.middlewares.use(imageProxyMiddleware)
      server.middlewares.use(mediaProxyMiddleware)
      printBanner(server)
    },
    configurePreviewServer(server) {
      server.middlewares.use(guard)
      server.middlewares.use(qqAuthMiddleware)
      server.middlewares.use(imageProxyMiddleware)
      server.middlewares.use(mediaProxyMiddleware)
      printBanner(server)
    },
  }
}

/** 局域网模式下，服务就绪后打印可访问地址与一次性口令 */
function printBanner(server) {
  if (!ACCESS_CODE) return
  const onListening = () => {
    const addresses = []
    for (const list of Object.values(os.networkInterfaces())) {
      for (const info of list || []) {
        if (info.family === 'IPv4' && !info.internal) addresses.push(info.address)
      }
    }
    const port = server.config.server.port || 5173
    const lines = [
      '',
      '  ┌───────────────────────────────────────────────',
      '  │  局域网模式已开启（手机可访问）',
      '  │',
      `  │  访问口令：  ${ACCESS_CODE}`,
      '  │',
      `  │  手机浏览器打开： http://${addresses[0] || '本机IP'}:${port}`,
      ...addresses.slice(1).map((a) => `  │                   http://${a}:${port}`),
      '  │',
      '  │  手机打不开时依次检查：',
      '  │   1) 端口别打错（是 5173，不是 5713 之类）',
      '  │   2) 手机要连【同一个 Wi-Fi】，不能走流量',
      '  │   3) 关掉手机上的 VPN / 代理(App)，否则会绕开局域网',
      '  │   4) 路由器访客网络 / AP 隔离会挡，改用主网络',
      '  │   5) 都不行就改用 start-usb.bat（USB 线，免 Wi-Fi 免口令）',
      '  │',
      '  │  ⚠ 同网段设备均可访问，请勿在公共 Wi-Fi 下开启',
      '  └───────────────────────────────────────────────',
      '',
    ]
    server.config.logger.info(lines.join('\n'))
  }
  if (server.httpServer?.listening) onListening()
  else server.httpServer?.once('listening', onListening)
}

// Capacitor 构建（--mode capacitor）：产物要放进 App 的 WebView 里加载，
// 因此使用相对资源路径，并且不需要本地代理/中间件（原生端由 src/platform 接管）。
export default defineConfig(({ mode }) => {
  const capacitor = mode === 'capacitor'
  // Release and Capacitor artifacts must never expose unfinished experimental UI.
  const showExperimental = !capacitor && mode !== 'production' && envFlag('BMP_SHOW_EXPERIMENTAL')

  return {
    base: capacitor ? './' : '/',
    plugins: capacitor ? [vue()] : [vue(), qqAuth()],
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version || '0.0.0'),
      __APP_BUILD__: JSON.stringify(BUILD_TIME),
      __APP_SHOW_EXPERIMENTAL__: JSON.stringify(showExperimental),
      __APP_RELEASE__: JSON.stringify(mode === 'production' || mode === 'capacitor'),
    },
    server: {
      // 默认仅监听本机。只有显式设置 BMP_LAN=1 时才绑定局域网，并且会强制要求访问口令。
      host: LAN_MODE ? true : '127.0.0.1',
      port: 5173,
      proxy: PROXIES,
    },
    preview: {
      host: LAN_MODE ? true : '127.0.0.1',
      proxy: PROXIES,
    },
  }
})
