/**
 * 网页登录（仅 Android）：打开腾讯官方登录页，取回登录后的 Cookie。
 *
 * 入口用 core/qqLogin.js 的 webLoginUrl()：
 *   = xlogin(普通登录页: 二维码/密码) + s_url=OAuth authorize
 * 不能用 xlogin 的默认 s_url=login_jump（登录后会停在空页面），
 * 也不能直接进 authorize（会落到依赖本机 QQ 客户端的「PC 一键登录」变体页）。
 */
import { webLoginUrl, authorizeUrl } from '../../core/qqLogin.js'

/**
 * @param {object} plugin 原生插件实例（registerPlugin('QqWebLogin')）
 * @param {object} [opts]
 * @param {(cookie: string) => Promise<{cookie: string, hasMusicKey: boolean, diag?: object}>} [opts.finish]
 *   票据补完：WebView 只负责登录，若回传的 Cookie 里还没有 qm_keyst 但已有 p_skey，
 *   就由 core/qqLogin.js 自己跑 authorize→code→musicu 兑换，
 *   从而绕开 QQ 授权页（那里会要求拉起手机 QQ）。
 */
export function createNativeWebLogin(plugin, { finish } = {}) {
  if (!plugin) throw new Error('createNativeWebLogin 需要插件实例')

  return {
    /**
     * 打开登录页。
     * @param {object} [opts]
     * @param {boolean} [opts.allowOneKey] 实验开关：允许用户在腾讯授权页点「一键登录」
     *   （开启后原生侧不再检测到 p_skey 就自动返回，好让用户尝试拉起手机 QQ）
     * 成功返回 { cookie, url, hasMusicKey, cookieNames, navLog, jumpUrl }；
     * 用户取消会抛错。
     */
    async open(opts = {}) {
      const allowOneKey = Boolean(opts.allowOneKey)
      // 实验模式直接进 OAuth 授权地址：若 WebView 里已有登录态，会**直接**显示
      // 「一键登录」授权页；否则它自己会先要求登录（这是腾讯的流程，无法跳过）
      const url = allowOneKey ? authorizeUrl() : webLoginUrl()
      // 注意：不要覆盖 User-Agent。实测两种 UA 各有利弊且都不稳定：
      //  · 移动 UA → 腾讯给 style=35&sdkp=pcweb 的「一键登录」页（无可用表单）
      //  · 桌面 UA → 腾讯给 graph.qq.com/.../show?which=Login&display=pc，
      //    但该页是为「PC 浏览器 + 本机 QQ 客户端」设计的，在手机 WebView 里只渲染出
      //    权限勾选骨架（没有登录表单/授权按钮）
      // 所以「网页登录」能否成功取决于腾讯当天返回的页面变体；可靠的是「扫码登录」
      // （完全由本项目的 src/core/qqLogin.js 控制）。
      const res = await plugin.open({ url, allowOneKey })
      const out = {
        cookie: String(res?.cookie || '').trim(),
        url: String(res?.url || ''),
        hasMusicKey: Boolean(res?.hasMusicKey),
        cookieNames: String(res?.cookieNames || ''),
        navLog: String(res?.navLog || ''),
        jumpUrl: String(res?.jumpUrl || ''),
      }

      // WebView 里登录成功但票据未兑换（QQ 授权页要靠拉起 QQ App）→ 我们自己补完
      if (!out.hasMusicKey && typeof finish === 'function' && /(?:^|;\s*)p_skey=/.test(out.cookie)) {
        try {
          const r = await finish(out.cookie)
          if (r?.cookie) {
            out.cookie = r.cookie
            out.hasMusicKey = Boolean(r.hasMusicKey)
            out.completedLocally = true
            out.finishDiag = r.diag || null
          }
        } catch (e) {
          out.finishError = String(e?.message || e)
        }
      }
      return out
    },

    /** 清空 WebView 浏览器 Cookie（退出登录时调用） */
    async clear() {
      try {
        await plugin.clear()
      } catch {
        /* 清理失败不影响主流程 */
      }
    },
  }
}
