/**
 * e2e / 平台层测试用的请求 mock 工具（Node 侧，不进浏览器包）。
 *
 * 用法：
 *   import { setRequestTransport } from '../../src/core/http.js'
 *   const transport = createMockTransport([
 *     { match: /musicu\.fcg/, respond: loadFixture('qq/song-url.json') },
 *   ])
 *   setRequestTransport(transport)
 *   ... 断言 ...
 *   setRequestTransport(null)
 *
 * 约定：未命中的请求直接抛错，避免测试静默打到真实网络。
 */
import { readFileSync } from 'node:fs'

const FIXTURE_DIR = new URL('../fixtures/', import.meta.url)

/** 载入 scripts/fixtures/<rel>.json */
export function loadFixture(rel) {
  return JSON.parse(readFileSync(new URL(rel, FIXTURE_DIR), 'utf8'))
}

/** 构造 fetch 兼容的 JSON 响应 */
export function jsonResponse(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
    text: async () => JSON.stringify(data),
  }
}

/**
 * @param {Array<{ match: RegExp | ((url: string, init: object) => boolean), respond: object | Function }>} routes
 *        respond 为对象时自动包装成 200 JSON；为函数时原样返回（可自定义状态码/文本）
 * @param {{ label?: string }} opts
 * @returns 带 calls 记录的 transport 函数
 */
export function createMockTransport(routes, { label = 'mock' } = {}) {
  const calls = []
  const transport = async (url, init = {}) => {
    calls.push({ url, init })
    for (const route of routes) {
      const hit = route.match instanceof RegExp ? route.match.test(url) : route.match(url, init)
      if (!hit) continue
      const out = typeof route.respond === 'function' ? route.respond(url, init) : route.respond
      return out && typeof out.ok === 'boolean' ? out : jsonResponse(out)
    }
    throw new Error(`${label}: 未匹配的请求 ${url}`)
  }
  transport.calls = calls
  return transport
}

/** 解析 musicu POST 请求体（用于断言 module/method/param） */
export function parseMusicuBody(init) {
  try {
    return JSON.parse(init?.body || '{}')
  } catch {
    return {}
  }
}
