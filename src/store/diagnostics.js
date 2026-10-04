/**
 * 自动体检（诊断面板）与全局运行时错误捕获。
 */
import { computed } from 'vue'
import { state } from './state.js'
import { recordError } from './errors.js'
import { pingServer } from '../api/auth.js'
import {
  fetchUserInfo,
  fetchUserPlaylists,
  fetchUserPlaylistsRaw,
  fetchCollectedPlaylists,
  fetchLikedSongs,
  fetchUserAlbums,
  fetchPlaylistSongs,
  fetchAlbumSongs,
} from '../api/qq.js'
import { searchVideo } from '../api/bilibili.js'
import { ensureEuin } from './library.js'

// 全局运行时错误捕获：任何未处理异常都会进入诊断面板，而不是静默失败
if (typeof window !== 'undefined') {
  window.addEventListener('error', (e) => recordError('未捕获异常', e.message || e.error?.message || '未知错误'))
  window.addEventListener('unhandledrejection', (e) =>
    recordError('未处理的 Promise', e.reason?.message || String(e.reason || '未知错误'))
  )
}

/** 自动体检：逐项探测登录态与各功能是否可用，返回失败项 */
/** 只列 Cookie 名字，不显示值（用于诊断展示） */
function cookieNamesHint(cookie) {
  const names = String(cookie || '')
    .split(';')
    .map((s) => s.trim().split('=')[0])
    .filter(Boolean)
  const key = names.filter((n) => /^(qm_keyst|qqmusic_key|uin|p_uin|pt2gguin|p_skey|skey)$/.test(n))
  return `${names.length} 项${key.length ? '：' + key.join(', ') : '，无关键项'}`
}

export async function runDiagnostics() {
  if (state.diagnostics.running) return []
  state.diagnostics.running = true
  const checks = []
  const uin = state.config.uin
  const cookie = state.config.qqCookie
  const hasMusicKey = /(?:^|;\s*)(qm_keyst|qqmusic_key)=/.test(cookie || '')

  const add = (label, ok, detail, suggestion) =>
    checks.push({ label, ok, detail: detail || '', suggestion: suggestion || '' })
  const addWarn = (label, detail, suggestion) =>
    checks.push({ label, ok: null, detail: detail || '', suggestion: suggestion || '' })

  // 第 0 步：先确认页面能连上本地服务（Vite 的代理/中间件）。
  // 若这一步失败，后面所有接口必然都是 "Failed to fetch"，据此直接给出结论。
  const origin = typeof location !== 'undefined' ? location.origin : ''
  const serverUp = await pingServer()
  add(
    '本地服务连通性',
    serverUp,
    serverUp ? `已连接 ${origin}` : `无法连接 ${origin}`,
    serverUp ? '' : '请用「start.bat / npm run dev」启动，并通过该地址访问（不要直接双击打开 dist/index.html）'
  )
  if (!serverUp) {
    state.diagnostics.checks = checks
    state.diagnostics.ranAt = Date.now()
    state.diagnostics.running = false
    state.diagnostics.verdict =
      `页面连不上本地服务（${origin}）：所有接口都会 Failed to fetch。` +
      '请确认服务正在运行，且你是通过 http://localhost:5173 打开页面，而不是直接打开构建产物。'
    return checks.filter((c) => c.ok === false)
  }

  // 局域网模式下，未解锁会让所有接口 401，先明确告知
  if (state.auth.required && !state.auth.authed) {
    add('访问口令', false, '未解锁', '输入终端里显示的访问口令后重试')
    state.diagnostics.checks = checks
    state.diagnostics.ranAt = Date.now()
    state.diagnostics.running = false
    state.diagnostics.verdict = '需要访问口令：请在解锁页输入终端（启动服务时）显示的口令。'
    return checks.filter((c) => c.ok === false)
  }

  const methodLabel = { qr: '扫码登录', web: '网页登录', cookie: '手动 Cookie' }[state.loginMethod] || '未知'
  add('登录方式', Boolean(state.loginMethod), methodLabel, state.loginMethod ? '' : '重新登录')
  add('本地登录 Cookie', Boolean(cookie), cookie ? `长度 ${cookie.length}` : '未保存', '请先登录')
  add(
    'Cookie 项目',
    cookie ? /(?:^|;\s*)(uin|p_uin|pt2gguin)=/.test(cookie) : false,
    cookie ? cookieNamesHint(cookie) : '未保存',
    '缺少 uin 说明登录未完成'
  )
  add('解析到 QQ 号', Boolean(uin), uin || '未解析到', '重新登录')
  if (state.webLoginInfo) {
    addWarn(
      '网页登录落地',
      `最终地址：${String(state.webLoginInfo.finalUrl || '').slice(0, 80)}`,
      state.webLoginInfo.jumpUrl ? '已捕获登录跳板 URL' : '未见 check_sig/authorize 跳转'
    )
  }
  hasMusicKey
    ? add('音乐票据 qm_keyst', true, '已包含')
    : addWarn('音乐票据 qm_keyst', '未包含', '缺少它时部分音乐接口不可用（扫码被拒 p_skey 时会出现）')

  let createdOk = false
  let collectedOk = false
  let createdCount = 0
  let collectedCount = 0
  let nickname = state.user?.nickname || ''

  try {
    const info = await fetchUserInfo(uin, cookie)
    nickname = info.nickname || nickname
    add('用户资料接口', true, `昵称：${info.nickname || '(空)'}`)
  } catch (e) {
    // 昵称在扫码时已经拿到，资料接口失败通常只是拿不到头像/会员，属于次要问题
    if (nickname) {
      addWarn('用户资料接口', `${e.message}（昵称已由登录时获得：${nickname}）`, '仅影响头像/会员显示，不影响歌单')
    } else {
      add('用户资料接口', false, e.message, '登录态可能无效，建议重新登录或改用手动 Cookie')
    }
  }

  try {
    const list = await fetchUserPlaylists(uin, cookie)
    createdOk = true
    createdCount = list.length
    let rawInfo = ''
    try {
      const raw = await fetchUserPlaylistsRaw(uin, cookie)
      rawInfo = `原始 ${raw.total} 条，含 tid ${raw.withTid} 条`
      if (raw.likedExcluded) rawInfo += `，已排除「我喜欢」${raw.likedExcluded} 条`
      if (raw.total > raw.withTid) {
        rawInfo += `，样本：${JSON.stringify(raw.sample)}`
      }
    } catch {
      /* 忽略 */
    }
    add('创建的歌单', true, `${list.length} 个${rawInfo ? `（接口返回：${rawInfo}）` : ''}`)
  } catch (e) {
    add('创建的歌单', false, e.message, '接口不可用或登录态无效')
  }

  try {
    const list = await fetchCollectedPlaylists(uin, cookie)
    collectedOk = true
    collectedCount = list.length
    add('收藏的歌单', true, `${list.length} 个`)
  } catch (e) {
    add('收藏的歌单', false, e.message, '接口可能已变更，或该账号无收藏权限')
  }

  // 「我喜欢的音乐」（dirid=201）——用户最关心的数据
  let likedOk = false
  let likedCount = 0
  try {
    const euin = await ensureEuin()
    const { songs, total, pages } = await fetchLikedSongs(uin, euin, cookie)
    likedOk = true
    likedCount = total || songs.length
    add(
      '我喜欢的音乐',
      songs.length ? true : false,
      `${songs.length} 首${total && total !== songs.length ? ` / 接口 total=${total}` : ''}（分页 ${pages} 次）`,
      songs.length ? '' : '接口返回 0 首，可能是登录态受限'
    )
  } catch (e) {
    add('我喜欢的音乐', false, e.message, '新版网关接口需要有效登录态（qm_keyst）或接口已变更')
  }

  // 收藏的专辑
  let albumOk = false
  let albumCount = 0
  try {
    const euin = await ensureEuin()
    const { albums, total, pages } = await fetchUserAlbums(uin, euin, cookie)
    albumOk = true
    albumCount = total || albums.length
    add('收藏的专辑', true, `${albums.length} 张${total && total !== albums.length ? ` / 接口 total=${total}` : ''}（分页 ${pages} 次）`)
  } catch (e) {
    add('收藏的专辑', false, e.message, '新版网关接口需要有效登录态（qm_keyst）或接口已变更')
  }

  // 歌单/专辑详情：用第一个可用对象验证
  const sample = state.playlists[0]
  if (sample) {
    try {
      const { songs } = await fetchPlaylistSongs(sample.id, cookie)
      add('歌单详情', songs.length > 0, `《${sample.name}》读到 ${songs.length} 首`)
    } catch (e) {
      add('歌单详情', false, e.message, '详情接口不可用')
    }
  } else if (state.albums[0]) {
    try {
      const { songs } = await fetchAlbumSongs(state.albums[0].mid, cookie)
      add('专辑详情', songs.length > 0, `《${state.albums[0].name}》读到 ${songs.length} 首`)
    } catch (e) {
      add('专辑详情', false, e.message, '专辑详情接口不可用')
    }
  } else {
    addWarn('歌单/专辑详情', '暂无可测的歌单或专辑', '先成功导入后再检测')
  }

  try {
    const videos = await searchVideo('晴天 周杰伦', state.config.biliCookie)
    videos.length
      ? add('B站搜索', true, `${videos.length} 条结果`)
      : add('B站搜索', false, '无结果', '可能是风控，配置 B站 Cookie 可改善')
  } catch (e) {
    const msg = e.message || ''
    const isNet = /超时|timeout|Failed to fetch|请求失败|502|504|500/.test(msg)
    add(
      'B站搜索',
      false,
      msg,
      isNet
        ? '网络层失败：多为代理软件(Clash/TUN)节点不稳或限制了 B站，建议给 *.bilibili.com / *.hdslb.com 加 DIRECT 规则'
        : '可能是风控（-412），配置 B站 Cookie 可改善'
    )
  }

  const failed = checks.filter((c) => c.ok === false)
  const warned = checks.filter((c) => c.ok === null)
  state.diagnostics.checks = checks
  state.diagnostics.ranAt = Date.now()
  state.diagnostics.running = false
  state.diagnostics.verdict = buildVerdict({ failed, warned, createdOk, collectedOk, hasMusicKey, createdCount, collectedCount, likedOk, likedCount, albumOk, albumCount })
  return failed
}

function buildVerdict({ failed, warned, createdOk, collectedOk, hasMusicKey, createdCount, collectedCount, likedOk, likedCount, albumOk, albumCount }) {
  if (!failed.length) {
    if (!createdOk && !collectedOk) return '未登录或不适用：请先登录后查看歌单。'
    if (createdCount + collectedCount === 0 && (warned.length === 0 || warned.every((w) => w.label !== '创建的歌单'))) {
      if (hasMusicKey) return '登录正常，接口均可用；该账号返回 0 个歌单（可能确实没有创建/收藏歌单）。'
      return '歌单接口可用，但该账号返回 0 个歌单；同时缺少 qm_keyst，不排除它是私密数据未被授权的表现。'
    }
    if (!likedOk) {
      return '普通歌单可读，但「我喜欢的音乐」读取失败（缺 qm_keyst 时常见）。详见上方该项说明。'
    }
    if (!albumOk) {
      return '歌单与「我喜欢」可读，但「收藏的专辑」读取失败。详见上方该项说明。'
    }
    if (!hasMusicKey) return `歌单、我喜欢（${likedCount} 首）、专辑（${albumCount} 张）均可读取；仅缺少 qm_keyst（头像/会员等次要信息不可用）。`
    return '全部功能可用。'
  }
  const labels = failed.map((f) => f.label).join('、')
  if (!createdOk && !collectedOk) {
    return `登录态无效或歌单接口不可用（失败：${labels}）。建议重新登录，或在设置里改用手动 Cookie。`
  }
  if (!likedOk) {
    return `「我喜欢的音乐」读取失败（失败：${labels}）。该接口走新版网关，通常需要完整登录态；若同时缺少 qm_keyst，请参考账号侧说明。`
  }
  if (!albumOk) {
    return `「收藏的专辑」读取失败（失败：${labels}）。该接口走新版网关，通常需要完整登录态。`
  }
  if (!collectedOk) {
    return `收藏歌单接口不可用（失败：${labels}），但创建的歌单仍可正常使用。可能是腾讯接口调整。`
  }
  if (!hasMusicKey) {
    return `缺少音乐票据 qm_keyst，部分接口受限（失败：${labels}）。这通常由扫码时腾讯拒绝下发 p_skey 引起。`
  }
  return `以下功能异常：${labels}。详见上方每项说明。`
}

export const failedChecks = computed(() => state.diagnostics.checks.filter((c) => c.ok === false))
