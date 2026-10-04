/**
 * 上游服务路由表与请求头规则。
 *
 * 这份配置是 **Web（Vite 开发服务器代理）** 与 **移动端（Capacitor 原生 HTTP）** 的
 * 唯一事实来源：两端的请求适配层都按它来决定「相对路径 → 真实域名 + Referer/Cookie」。
 *
 * ⚠️ 本文件会被打进浏览器包，禁止引入任何 Node 专有 API。
 */

export const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

/**
 * 代理前缀 → 上游信息
 * - target:       移动端直连时使用的真实域名
 * - referer/origin: 上游校验所需的请求头
 * - cookieHeader: 前端传给本地代理的自定义头名（浏览器禁止设置 Cookie 头）
 * - cookieName:   在代理层读取该头（小写）并写成真正的 Cookie
 * - cookies:      该前缀需要携带哪一类 Cookie（qq / bili）
 */
export const UPSTREAMS = {
  '/qq-api': {
    name: 'c.y.qq.com',
    target: 'https://c.y.qq.com',
    referer: 'https://y.qq.com/',
    origin: 'https://y.qq.com',
    cookieHeader: 'X-QQ-Cookie',
    cookieName: 'x-qq-cookie',
    cookies: 'qq',
    label: 'QQ音乐接口',
  },
  '/qqmu-api': {
    name: 'u.y.qq.com',
    target: 'https://u.y.qq.com',
    referer: 'https://y.qq.com/',
    origin: 'https://y.qq.com',
    cookieHeader: 'X-QQ-Cookie',
    cookieName: 'x-qq-cookie',
    cookies: 'qq',
    label: 'QQ音乐网关',
  },
  '/bili-api': {
    name: 'api.bilibili.com',
    target: 'https://api.bilibili.com',
    referer: 'https://www.bilibili.com/',
    origin: 'https://www.bilibili.com',
    cookieHeader: 'X-Bili-Cookie',
    cookieName: 'x-bili-cookie',
    cookies: 'bili',
    label: 'B站接口',
  },
}

/** 图片代理允许的域名（服务端中间件与移动端适配层共用） */
export const IMAGE_HOST_ALLOW = /(^|\.)(hdslb\.com|bilivideo\.com|gtimg\.cn|qlogo\.cn|qq\.com)$/i

/** 需要走图片代理的域名：B站封面有防盗链，其它（QQ封面）可直连 */
export const IMAGE_PROXY_HOST = /hdslb\.com|bilivideo\.com/i

/**
 * 音频流代理允许的域名。
 * - B站官方镜像；PCDN 域名不在此列，需回退内嵌播放
 * - QQ 音乐 CDN：`*.stream.qqmusic.qq.com`（vkey 直链）、`*.music.tc.qq.com`（试听/下载）
 */
export const MEDIA_HOST_ALLOW =
  /(^|\.)(bilivideo\.com|bilivideo\.cn|akamaized\.net|hdslb\.com|acgvideo\.com|qqmusic\.qq\.com|tc\.qq\.com)$/i

/**
 * 防盗链 Referer 规则（服务端代理与移动端适配层共用）。
 * 按域名匹配，未命中时由调用方决定回退策略。
 */
export const REFERER_BY_HOST = [
  {
    re: /(^|\.)(hdslb\.com|bilivideo\.com|bilivideo\.cn|akamaized\.net|acgvideo\.com)$/i,
    referer: 'https://www.bilibili.com/',
    origin: 'https://www.bilibili.com',
  },
  {
    re: /(^|\.)(gtimg\.cn|qlogo\.cn|qq\.com)$/i,
    referer: 'https://y.qq.com/',
    origin: 'https://y.qq.com',
  },
]

/** 按 URL 域名取 Referer/Origin 规则；未命中返回 null */
export function refererForHost(url) {
  try {
    const host = new URL(url).hostname
    for (const rule of REFERER_BY_HOST) {
      if (rule.re.test(host)) return rule
    }
  } catch {
    /* URL 不合法时不带 Referer */
  }
  return null
}

/** 该前缀是否由本地代理转发 */
export function resolveUpstream(path) {
  for (const [prefix, cfg] of Object.entries(UPSTREAMS)) {
    if (path === prefix || path.startsWith(prefix + '/')) return { prefix, ...cfg }
  }
  return null
}

/** 判断某个绝对 URL 是否在图片白名单内 */
export function isAllowedImageHost(url) {
  try {
    return IMAGE_HOST_ALLOW.test(new URL(url).hostname)
  } catch {
    return false
  }
}

/** 判断某个绝对 URL 是否在音频白名单内 */
export function isAllowedMediaHost(url) {
  try {
    return MEDIA_HOST_ALLOW.test(new URL(url).hostname)
  } catch {
    return false
  }
}
