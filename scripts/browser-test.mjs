/**
 * 无头浏览器 UI 测试（Chrome DevTools Protocol）
 *
 * 用法：
 *   1) 先启动 dev server：npm run dev
 *   2) node scripts/browser-test.mjs
 *
 * 可选：注入登录 Cookie 以测试登录后的流程（Cookie 通过环境变量传入，不要写进仓库）
 *   PowerShell:
 *     $env:BMP_COOKIE = (Get-Content .tmp-cookie.txt -Raw)
 *     node scripts/browser-test.mjs --logged-in
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadFixture } from './lib/mock-transport.mjs'

const APP = process.env.BMP_URL || 'http://127.0.0.1:5173/'
const LOGGED_IN = process.argv.includes('--logged-in')
const LOCKED = process.argv.includes('--locked')
const MOBILE = process.argv.includes('--mobile')
const DEMO = process.argv.includes('--demo')

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
]
const chromePath = CHROME_CANDIDATES.find((p) => existsSync(p))
if (!chromePath) {
  console.error('找不到 Chrome/Edge')
  process.exit(1)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0
let fail = 0
const log = (name, ok, extra = '') => {
  if (ok) pass++
  else fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  — ${extra}` : ''}`)
}

const profileDir = mkdtempSync(join(tmpdir(), 'bmp-chrome-'))
const chrome = spawn(
  chromePath,
  [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-component-extensions-with-background-pages',
    '--disable-gpu',
    '--mute-audio',
    '--window-size=1440,900',
    'about:blank',
  ],
  { stdio: 'ignore' }
)

function cleanup() {
  try {
    chrome.kill()
  } catch {}
  try {
    rmSync(profileDir, { recursive: true, force: true })
  } catch {}
}

let PORT = 0
async function waitDebugger() {
  // Chrome 用 --remote-debugging-port=0 时会挑选空闲端口并写入 DevToolsActivePort
  const portFile = join(profileDir, 'DevToolsActivePort')
  for (let i = 0; i < 100; i++) {
    if (existsSync(portFile)) {
      try {
        const [p] = readFileSync(portFile, 'utf8').split('\n')
        const n = Number(p.trim())
        if (n > 0) {
          PORT = n
          const r = await fetch(`http://127.0.0.1:${PORT}/json/version`)
          if (r.ok) return true
        }
      } catch {}
    }
    await sleep(300)
  }
  return false
}

let ws
let msgId = 0
const pending = new Map()
const consoleErrors = []
const failedRequests = []

// ---------- CDP Fetch mock（UI 测试零外网：拦截 musicu 等请求并返回 fixture） ----------
let fetchMockActive = false
let fetchMockPaused = 0
const fetchMockRoutes = []
async function enableFetchMock() {
  fetchMockActive = true
  await send('Fetch.enable', {
    patterns: [
      { urlPattern: '*qqmu-api*', requestStage: 'Request' },
      { urlPattern: '*qq-api*', requestStage: 'Request' },
      // 登录二维码（F1–F3 健壮性用例）：只拦 /auth-api/qr/*，不碰 ping/unlock
      { urlPattern: '*auth-api/qr/*', requestStage: 'Request' },
    ],
  })
}
async function disableFetchMock() {
  fetchMockActive = false
  try {
    await send('Fetch.disable')
  } catch {}
}
/** 注册 QQ 搜索 mock（c.y.qq.com 经典 CGI，GET；按 t/p 返回 fixture） */
function mockQqSearch() {
  fetchMockRoutes.push({
    match: (url) => /search_for_qq_cp|client_music_search_songlist/.test(url),
    respond: (url) => {
      if (/client_music_search_songlist/.test(url)) return loadFixture('qq/search-playlist.json')
      const u = new URL(url)
      const t = u.searchParams.get('t')
      const p = u.searchParams.get('p')
      if (t === '0') return loadFixture(`qq/search-song${p === '2' ? '-page2' : ''}.json`)
      if (t === '8') return loadFixture('qq/search-album.json')
      throw new Error(`未覆盖的搜索类型 t=${t}`)
    },
  })
}
/** 注册热搜（musicu POST）+ 输入联想（smartbox GET）mock */
function mockQqHotSuggest() {
  fetchMockRoutes.push({
    match: (url, postData) => /qqmu-api/.test(url) && /HotkeyService/.test(postData || ''),
    respond: () => loadFixture('qq/hotkey.json'),
  })
  fetchMockRoutes.push({
    match: (url) => /smartbox_new/.test(url),
    respond: () => loadFixture('qq/suggest.json'),
  })
}
/** 注册排行榜 mock（GetAll / GetDetail；topId=62 返回改写的「飙升榜」用于验证切换） */
function mockQqRank() {
  fetchMockRoutes.push({
    match: (url, postData) => /qqmu-api/.test(url) && /ToplistInfoServer/.test(postData || ''),
    respond: (url, postData) => {
      let body = {}
      try {
        body = JSON.parse(postData || '{}')
      } catch {}
      const method = body?.req_0?.method
      if (method === 'GetAll') return loadFixture('qq/rank-index.json')
      if (method === 'GetDetail') {
        const fx = loadFixture('qq/rank-detail.json')
        if (Number(body?.req_0?.param?.topId) === 62) {
          fx.req_0.data.data.title = '飙升榜'
          fx.req_0.data.data.song[0].rankValue = '15%'
        }
        return fx
      }
      throw new Error(`未覆盖的榜单方法 ${method}`)
    },
  })
}
/** 注册歌单广场 mock（分类配置 / 分类列表 / 歌单详情；非「全部」分类改写首个歌单名） */
function mockQqSquare() {
  fetchMockRoutes.push({ match: (url) => /fcg_get_diss_tag_conf/.test(url), respond: () => loadFixture('qq/square-tags.json') })
  fetchMockRoutes.push({
    match: (url) => /fcg_get_diss_by_tag/.test(url),
    respond: (url) => {
      const u = new URL(url)
      const fx = loadFixture(u.searchParams.get('sin') === '30' ? 'qq/square-list-page2.json' : 'qq/square-list.json')
      if (u.searchParams.get('categoryId') !== '10000000') fx.data.list[0].dissname = '摇滚精选｜现场热歌'
      return fx
    },
  })
  fetchMockRoutes.push({
    match: (url, postData) => /qqmu-api/.test(url) && /CgiGetDiss/.test(postData || ''),
    respond: (url, postData) => {
      const fx = loadFixture('qq/square-playlist.json')
      // 自建歌单（写 mock 有状态）：按请求的 disstid 回填 id/名称/数量，供「从歌单移除」等 owner 判定
      let body = {}
      try {
        body = JSON.parse(postData || '{}')
      } catch {}
      const id = String(body?.req_0?.param?.disstid || '')
      const created = demoCreatedPlaylists.find((p) => String(p.tid) === id || String(p.dirid) === id)
      if (created) {
        fx.req_0.data.dirinfo.id = Number(id) || fx.req_0.data.dirinfo.id
        fx.req_0.data.dirinfo.title = created.name
        fx.req_0.data.dirinfo.songnum = fx.req_0.data.songlist.length
      }
      return fx
    },
  })
}
/** 注册每日推荐 mock（GetRadarSong 按 Page 返回 fixture） */
function mockQqDaily() {
  fetchMockRoutes.push({
    match: (url, postData) => /qqmu-api/.test(url) && /GetRadarSong/.test(postData || ''),
    respond: (url, postData) => {
      let body = {}
      try {
        body = JSON.parse(postData || '{}')
      } catch {}
      return loadFixture(body?.req_0?.param?.Page === 2 ? 'qq/daily-radar-page2.json' : 'qq/daily-radar.json')
    },
  })
}
/** 注册歌手页 mock（详情 / 单曲 / 专辑 / 相似歌手，按模块路由） */
function mockQqArtist() {
  fetchMockRoutes.push({
    match: (url, postData) => /qqmu-api/.test(url) && /web_singer_info_svr|song_list_server|AlbumListServer|SimilarSingerSvr/.test(postData || ''),
    respond: (url, postData) => {
      let body = {}
      try {
        body = JSON.parse(postData || '{}')
      } catch {}
      const module = body?.req_0?.module
      if (module === 'music.web_singer_info_svr') return loadFixture('qq/artist-detail.json')
      if (module === 'musichall.song_list_server') return loadFixture('qq/artist-songs.json')
      if (module === 'music.musichallAlbum.AlbumListServer') return loadFixture('qq/artist-albums.json')
      if (module === 'music.SimilarSingerSvr') return loadFixture('qq/artist-similar.json')
      throw new Error(`未覆盖的歌手模块 ${module}`)
    },
  })
}
/** 注册专辑页 mock（旧接口歌曲 + musicu 详情增强） */
function mockQqAlbum() {
  fetchMockRoutes.push({ match: (url) => /fcg_v8_album_info_cp/.test(url), respond: () => loadFixture('qq/album-songs.json') })
  fetchMockRoutes.push({
    match: (url, postData) => /qqmu-api/.test(url) && /GetAlbumDetail/.test(postData || ''),
    respond: () => loadFixture('qq/album-detail.json'),
  })
}

/** 注册歌曲详情 mock（相似歌曲 musicu + 评论旧接口 + 评论写 P5 E2，有状态） */
function mockQqSongDetail() {
  fetchMockRoutes.push({
    match: (url, postData) => /qqmu-api/.test(url) && /GetSimilarSongs/.test(postData || ''),
    respond: () => loadFixture('qq/song-similar.json'),
  })
  // 有状态评论：发表后读接口能看到（含 uin=10000 → 可删除），供 UI 全链路
  const ownComments = []
  const writes = []
  fetchMockRoutes.push({
    match: (url) => /fcg_global_comment_h5/.test(url),
    respond: () => {
      const fx = loadFixture('qq/song-comments-synthetic.json')
      fx.comment.commentlist = [...ownComments, ...(fx.comment.commentlist || [])]
      return fx
    },
  })
  fetchMockRoutes.push({
    match: (url, postData) => /musics\.fcg/.test(url) && /AddComment|DelComment/.test(postData || ''),
    respond: (url, postData) => {
      let body = {}
      try {
        body = JSON.parse(postData || '{}')
      } catch {}
      const method = body?.req_0?.method
      const param = body?.req_0?.param || {}
      writes.push({ method, param })
      if (method === 'AddComment') {
        ownComments.unshift({
          commentid: 'own-' + (ownComments.length + 1),
          nick: 'QQ 10000',
          avatarurl: '',
          rootcommentcontent: param.Content || '',
          praisenum: 0,
          time: Math.floor(Date.now() / 1000),
          uin: '10000',
        })
        return { code: 0, req_0: { code: 0, data: {} } }
      }
      if (method === 'DelComment') {
        const i = ownComments.findIndex((c) => c.commentid === param.CommentId)
        if (i > -1) ownComments.splice(i, 1)
        return { code: 0, req_0: { code: 0, data: { Subcode: 0 } } }
      }
      throw new Error('未覆盖的评论写方法 ' + method)
    },
  })
  return { writes }
}

/** 注册红心 mock（回显空 + 加/删成功；demo cookie 带假 qm_keyst 以通过写票据检查） */
function mockQqFav() {
  fetchMockRoutes.push({
    // 红心写（dirId=201）才归本 mock；其它歌单写（dirId≠201）落到歌单管理 mock
    match: (url, postData) => {
      if (!/qqmu-api/.test(url)) return false
      if (/IsSongFanByMid/.test(postData || '')) return true
      if (!/AddSonglist|DelSonglist/.test(postData || '')) return false
      try {
        return Number(JSON.parse(postData).req_0.param.dirId) === 201
      } catch {
        return false
      }
    },
    respond: (url, postData) => {
      let body = {}
      try {
        body = JSON.parse(postData || '{}')
      } catch {}
      const method = body?.req_0?.method
      if (method === 'IsSongFanByMid') return { code: 0, req_0: { code: 0, data: { m_fan: {} } } }
      if (method === 'AddSonglist' || method === 'DelSonglist') {
        return { code: 0, req_0: { code: 0, data: { retCode: 0, result: { songlist: [{ songId: body?.req_0?.param?.v_songInfo?.[0]?.songId, existed: 0 }] } } } }
      }
      throw new Error(`未覆盖的写方法 ${method}`)
    },
  })
}

/** 注册歌单写操作 mock（P4.4/P4.6/P4.7/体验收尾②）：有状态的创建/删除/加歌 + 两个列表接口；写调用记进共享 log 供断言 */
const demoCreatedPlaylists = []
const demoFavedPlaylists = []
const playlistWriteLog = []
function mockQqPlaylistWrite() {
  const writes = playlistWriteLog
  fetchMockRoutes.push({
    match: (url) => /fcg_user_created_diss/.test(url),
    respond: () =>
      ({ code: 0, data: { disslist: demoCreatedPlaylists.map((p) => ({ tid: p.tid, dirid: p.dirid, diss_name: p.name, song_cnt: p.cnt, diss_cover: '', listen_num: 0 })) } }),
  })
  fetchMockRoutes.push({
    match: (url) => /fcg_get_profile_order_asset/.test(url),
    respond: () => ({ code: 0, data: { cdlist: demoFavedPlaylists.map((p) => ({ dissid: p.id, dissname: p.name, songnum: p.cnt })) } }),
  })
  fetchMockRoutes.push({
    match: (url, postData) => /musics\.fcg/.test(url) && /AddPlaylist|DelPlaylist|AddSonglist|DelSonglist/.test(postData || ''),
    respond: (url, postData) => {
      let body = {}
      try {
        body = JSON.parse(postData || '{}')
      } catch {}
      const method = body?.req_0?.method
      const param = body?.req_0?.param || {}
      writes.push({ method, param })
      if (method === 'AddPlaylist') {
        demoCreatedPlaylists.push({ tid: 9783375556, dirid: 1, name: param.dirName, cnt: 0 })
        return { code: 0, req_0: { code: 0, data: { retCode: 0, result: { dirId: 1, tid: 9783375556, dirName: param.dirName } } } }
      }
      if (method === 'DelPlaylist') {
        const i = demoCreatedPlaylists.findIndex((p) => String(p.dirid) === String(param.dirId))
        if (i > -1) demoCreatedPlaylists.splice(i, 1)
        return { code: 0, req_0: { code: 0, data: { retCode: 0, result: { dirId: param.dirId } } } }
      }
      if (method === 'AddSonglist' || method === 'DelSonglist') {
        const n = (param.v_songInfo || []).length
        for (const p of demoCreatedPlaylists) {
          if (String(p.dirid) === String(param.dirId)) p.cnt += method === 'AddSonglist' ? n : -n
        }
        return { code: 0, req_0: { code: 0, data: { retCode: 0, result: { songlist: (param.v_songInfo || []).map((s) => ({ ...s, existed: 0 })) } } } }
      }
      throw new Error(`未覆盖的歌单写方法 ${method}`)
    },
  })
  return { writes }
}

/** 注册歌单导入导出 mock（G5）：track info 批量补 songId（musicu） */
function mockQqTransfer() {
  fetchMockRoutes.push({
    match: (url, postData) => /qqmu-api/.test(url) && /CgiGetTrackInfo/.test(postData || ''),
    respond: (url, postData) => {
      let body = {}
      try {
        body = JSON.parse(postData || '{}')
      } catch {}
      const mids = body?.req_0?.param?.mids || []
      const tracks = mids.map((mid) => ({
        id: mid === 'm1' ? 97773 : 449205,
        mid,
        name: mid === 'm1' ? '晴天' : '稻香',
        singer: [{ name: '周杰伦' }],
        interval: 200,
        type: 0,
      }))
      return { code: 0, req_0: { code: 0, data: { tracks } } }
    },
  })
}
/** 注册收藏专辑/歌单 mock（P4.2/P4.3）：有状态，供 UI 收藏态回显 */
function mockQqFavWrite() {
  // D3 读取（musicu PlaylistFavRead）：与写入同源，返回当前收藏列表
  fetchMockRoutes.push({
    match: (url, postData) => /qqmu-api|musicu\.fcg/.test(url) && /CgiGetPlaylistFavInfo/.test(postData || ''),
    respond: () => ({
      code: 0,
      req_0: {
        code: 0,
        data: {
          total: demoFavedPlaylists.length,
          hasmore: 0,
          v_list: demoFavedPlaylists.map((p) => ({ tid: Number(p.id), dirId: 1, name: p.name, logo: '', songnum: p.cnt, nickname: 'demo' })),
        },
      },
    }),
  })
  fetchMockRoutes.push({
    match: (url, postData) => /musics\.fcg/.test(url) && /FavAlbum|CancelFavAlbum|FavPlaylist|CancelFavPlaylist/.test(postData || ''),
    respond: (url, postData) => {
      let body = {}
      try {
        body = JSON.parse(postData || '{}')
      } catch {}
      const method = body?.req_0?.method
      const param = body?.req_0?.param || {}
      if (method === 'FavAlbum' || method === 'CancelFavAlbum') {
        return { code: 0, req_0: { code: 0, data: { result: 0, v_failedAlbumId: [] } } }
      }
      if (method === 'FavPlaylist') {
        for (const id of param.v_playlistId || []) {
          if (!demoFavedPlaylists.some((p) => String(p.id) === String(id))) demoFavedPlaylists.push({ id: String(id), name: '收藏的歌单', cnt: 0 })
        }
        return { code: 0, req_0: { code: 0, data: { result: 0, v_failedPlaylistId: [] } } }
      }
      if (method === 'CancelFavPlaylist') {
        for (const id of param.v_playlistId || []) {
          const i = demoFavedPlaylists.findIndex((p) => String(p.id) === String(id))
          if (i > -1) demoFavedPlaylists.splice(i, 1)
        }
        return { code: 0, req_0: { code: 0, data: { result: 0, v_failedPlaylistId: [] } } }
      }
      throw new Error(`未覆盖的收藏方法 ${method}`)
    },
  })
}

// 演示数据里故意用了一个不存在的封面地址（用于验证「加载失败重试 + 音符占位」）。
// 它产生的 404 / 控制台报错属于用例本身，不算环境噪声，也不应判为失败。
const BROKEN_COVER_SENTINEL = 'bmp-broken-cover-test'
const isSentinelHit = (s) => String(s).includes(BROKEN_COVER_SENTINEL)

// 1×1 透明 PNG（登录健壮性用例的假二维码；不联网也能出图）
const MOCK_QR_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

/** 清掉上一轮注册的登录二维码 mock（避免旧路由优先命中） */
function clearAuthQrMocks() {
  for (let i = fetchMockRoutes.length - 1; i >= 0; i--) {
    if (fetchMockRoutes[i].authQr) fetchMockRoutes.splice(i, 1)
  }
}

/**
 * 注册登录二维码 mock（F1–F3 用例，完全离线）：
 *  - startFailFirst：前 N 次 /auth-api/qr/start 返回网络失败（其余返回假 PNG）
 *  - pollFailFirst：前 N 次 /auth-api/qr/poll 返回网络失败
 *  - 返回的 state.pollMode 可在用例中途改成 'error' | 'waiting'
 */
function mockAuthQr({ startFailFirst = 0, pollFailFirst = 0 } = {}) {
  clearAuthQrMocks()
  const state = { startCalls: 0, pollCalls: 0, pollMode: 'waiting', pollMessage: '请使用手机 QQ 扫码，并在手机上确认' }
  fetchMockRoutes.push({
    authQr: true,
    match: (url) => /\/auth-api\/qr\/start/.test(url),
    respond: () => {
      state.startCalls += 1
      if (state.startCalls <= startFailFirst) throw new Error('mock start fail')
      return { ok: true, image: MOCK_QR_PNG }
    },
  })
  fetchMockRoutes.push({
    authQr: true,
    match: (url) => /\/auth-api\/qr\/poll/.test(url),
    respond: () => {
      state.pollCalls += 1
      if (state.pollCalls <= pollFailFirst) throw new Error('mock poll fail')
      if (state.pollMode === 'error') return { status: 'error', message: '登录接口返回异常 (HTTP 502)' }
      return { status: 'waiting', message: state.pollMessage }
    },
  })
  return state
}

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })
}

async function evaluate(expression, { awaitPromise = false } = {}) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'evaluate 异常')
  return r.result?.value
}

;(async () => {
  try {
    if (!(await waitDebugger())) throw new Error('调试端口未就绪')
    const target = await (
      await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' })
    ).json()

    ws = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true })
      ws.addEventListener('error', rej, { once: true })
    })
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data)
      if (m.id && pending.has(m.id)) {
        const { resolve, reject } = pending.get(m.id)
        pending.delete(m.id)
        m.error ? reject(new Error(m.error.message)) : resolve(m.result)
        return
      }
      if (m.method === 'Runtime.exceptionThrown') {
        consoleErrors.push('exception: ' + (m.params.exceptionDetails?.exception?.description || '').split('\n')[0])
      }
      if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
        consoleErrors.push('console.error: ' + m.params.entry.text)
      }
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
        consoleErrors.push('console: ' + m.params.args.map((a) => a.value ?? a.description ?? '').join(' '))
      }
      if (m.method === 'Fetch.requestPaused') {
        fetchMockPaused += 1
        const { requestId, request } = m.params
        const route = fetchMockActive ? fetchMockRoutes.find((r) => r.match(request.url, request.postData)) : null
        if (route) {
          try {
            const payload = route.respond(request.url, request.postData)
            const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')
            send('Fetch.fulfillRequest', {
              requestId,
              responseCode: 200,
              responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
              body,
            }).catch((e) => console.log('    MOCK fulfill 失败:', e.message, request.url))
          } catch (e) {
            console.log('    MOCK respond 异常:', e.message)
            send('Fetch.failRequest', { requestId, errorReason: 'Failed' }).catch(() => {})
          }
        } else {
          send('Fetch.continueRequest', { requestId }).catch(() => {})
        }
      }
      if (m.method === 'Network.responseReceived') {
        const r = m.params.response
        if (r.status >= 400) failedRequests.push(`${r.status} ${r.url}`)
      }
    })

    await send('Runtime.enable')
    await send('Log.enable')
    await send('Page.enable')
    await send('Network.enable')

    // 移动端设备仿真（iPhone 14 尺寸），必须在导航前设置
    if (MOBILE) {
      await send('Emulation.setDeviceMetricsOverride', {
        width: 390,
        height: 844,
        deviceScaleFactor: 3,
        mobile: true,
      })
      await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
    }

    // ---------- 打开应用 ----------
    await send('Page.navigate', { url: APP })
    await sleep(3500)

    console.log('\n=== 未登录态渲染 ===')
    let ping = null
    try {
      ping = await evaluate("fetch('/auth-api/ping',{cache:'no-store'}).then(r=>r.json()).then(j=>j.ok).catch(()=>false)", {
        awaitPromise: true,
      })
    } catch {}
    log('页面内 /auth-api/ping 可用', ping === true, String(ping))

    const brand = await evaluate("document.querySelector('.brand')?.textContent?.trim() || ''")
    log('侧栏品牌为 bili-music-player', brand === 'bili-music-player', brand)

    const hasLogin = await evaluate("!!document.querySelector('.login-entry')")
    log('未登录时显示登录入口', hasLogin === true)

    const hasOverlay = await evaluate("!!document.querySelector('.overlay')")
    log('未登录时无异常弹窗', hasOverlay === false || (LOCKED && hasOverlay === true))

    // 移动端布局：抽屉
    if (MOBILE) {
      console.log('\n=== 移动端布局 ===')
      const defaultOpen = await evaluate(
        "(() => { const el = document.querySelector('.sidebar'); return { left: Math.round(el ? el.getBoundingClientRect().left : -999), backdrop: !!document.querySelector('.drawer-backdrop') } })()"
      )
      log('首次进入默认展开侧栏（抽屉 + 遮罩）', defaultOpen.left >= -1 && defaultOpen.backdrop === true, JSON.stringify(defaultOpen))

      const closedOnStart = await evaluate(
        `(async () => {
           document.querySelector('.drawer-backdrop')?.click()
           await new Promise(r => setTimeout(r, 400))
           return document.querySelector('.sidebar').getBoundingClientRect().left < -50
         })()`,
        { awaitPromise: true }
      )
      log('点遮罩收起抽屉（默认展开态）', closedOnStart === true)

      const menuVisible = await evaluate(
        "(() => { const b = document.querySelector('.menu-btn'); if (!b) return false; const r = b.getBoundingClientRect(); return r.width > 0 && getComputedStyle(b).display !== 'none' })()"
      )
      log('顶栏显示菜单按钮', menuVisible === true)

      const opened = await evaluate(
        `(async () => {
           document.querySelector('.menu-btn').click()
           await new Promise(r => setTimeout(r, 400))
           const r = document.querySelector('.sidebar').getBoundingClientRect()
           return { left: Math.round(r.left), backdrop: !!document.querySelector('.drawer-backdrop') }
         })()`,
        { awaitPromise: true }
      )
      log('点菜单展开抽屉 + 遮罩', opened.left >= -1 && opened.backdrop === true, JSON.stringify(opened))

      const closedDrawer = await evaluate(
        `(async () => {
           document.querySelector('.drawer-backdrop')?.click()
           await new Promise(r => setTimeout(r, 400))
           return document.querySelector('.sidebar').getBoundingClientRect().left < -50
         })()`,
        { awaitPromise: true }
      )
      log('点遮罩收起抽屉', closedDrawer === true)

      // 主界面右滑打开抽屉 / 抽屉左滑收起（触屏手势）；非主界面右滑无效
      const swipeDrawer = await evaluate(
        `(async () => {
           const sleep = (ms) => new Promise(r => setTimeout(r, ms))
           const fire = (el, type, x, y) => {
             const touch = new Touch({ identifier: 1, target: el, clientX: x, clientY: y })
             el.dispatchEvent(new TouchEvent(type, {
               touches: type === 'touchend' ? [] : [touch],
               changedTouches: [touch],
               bubbles: true,
               cancelable: true,
             }))
           }
           const content = document.querySelector('.content')
           if (!content) return { noContent: true }
           const hashBefore = location.hash
           fire(content, 'touchstart', 40, 400)
           fire(content, 'touchmove', 120, 404)
           fire(content, 'touchend', 170, 408)
           await sleep(450)
           const opened = { backdrop: !!document.querySelector('.drawer-backdrop'), left: Math.round(document.querySelector('.sidebar').getBoundingClientRect().left) }
           // 左滑收起（在遮罩上向左划）
           const bd = document.querySelector('.drawer-backdrop')
           if (bd) {
             fire(bd, 'touchstart', 300, 500)
             fire(bd, 'touchmove', 220, 504)
             fire(bd, 'touchend', 140, 508)
           }
           await sleep(450)
           const swipeClosed = !document.querySelector('.drawer-backdrop')
           if (!swipeClosed) document.querySelector('.drawer-backdrop')?.click()
           await sleep(300)
           // 非主界面（历史页）：菜单按钮可打开 → 左滑收起同样生效；右滑不打开
           location.hash = '#/history'
           await sleep(600)
           document.querySelector('.topbar .menu-btn')?.click()
           await sleep(400)
           const menuOpened = !!document.querySelector('.drawer-backdrop')
           const bd2 = document.querySelector('.drawer-backdrop')
           if (bd2) {
             fire(bd2, 'touchstart', 300, 500)
             fire(bd2, 'touchmove', 220, 504)
             fire(bd2, 'touchend', 140, 508)
           }
           await sleep(450)
           const menuClosed = !document.querySelector('.drawer-backdrop')
           const c2 = document.querySelector('.content')
           fire(c2, 'touchstart', 40, 400)
           fire(c2, 'touchmove', 120, 404)
           fire(c2, 'touchend', 170, 408)
           await sleep(450)
           const otherOpened = !!document.querySelector('.drawer-backdrop')
           // 非主界面左滑也不应打开播放队列
           fire(c2, 'touchstart', 300, 400)
           fire(c2, 'touchmove', 220, 404)
           fire(c2, 'touchend', 140, 408)
           await sleep(450)
           const otherQueueOpened = !!document.querySelector('.queue-overlay')
           location.hash = hashBefore || '#/'
           await sleep(500)
           // 主界面左滑 → 打开播放队列；面板上右滑 → 收起
           const c3 = document.querySelector('.content')
           fire(c3, 'touchstart', 300, 500)
           fire(c3, 'touchmove', 220, 504)
           fire(c3, 'touchend', 140, 508)
           await sleep(450)
           const queueOpened = !!document.querySelector('.queue-overlay')
           const qo = document.querySelector('.queue-overlay')
           if (qo) {
             fire(qo, 'touchstart', 180, 500)
             fire(qo, 'touchmove', 260, 504)
             fire(qo, 'touchend', 340, 508)
           }
           await sleep(450)
           const queueClosed = !document.querySelector('.queue-overlay')
           if (!queueClosed) document.querySelector('.queue-overlay')?.click()
           await sleep(300)
           return { opened: opened.backdrop, left: opened.left, swipeClosed, menuOpened, menuClosed, otherOpened, otherQueueOpened, queueOpened, queueClosed }
         })()`,
        { awaitPromise: true }
      )
      log('主界面右滑打开抽屉（触屏手势）', swipeDrawer.opened === true && swipeDrawer.left >= -1, JSON.stringify(swipeDrawer))
      log(
        '抽屉左滑收起（触屏手势；非主界面菜单打开后同样可左滑收起）',
        swipeDrawer.swipeClosed === true && swipeDrawer.menuOpened === true && swipeDrawer.menuClosed === true,
        JSON.stringify(swipeDrawer)
      )
      log(
        '一级页面（最近播放）右滑可打开抽屉；左滑不打开队列',
        swipeDrawer.otherOpened === true && swipeDrawer.otherQueueOpened === false,
        JSON.stringify(swipeDrawer)
      )
      log('主界面左滑打开播放队列（触屏手势）', swipeDrawer.queueOpened === true, JSON.stringify(swipeDrawer))
      log('播放队列右滑收起（触屏手势）', swipeDrawer.queueClosed === true, JSON.stringify(swipeDrawer))

      const matchHidden = await evaluate(
        "(() => { const el = document.querySelector('.song-head .col-match'); return !el || getComputedStyle(el).display === 'none' })()"
      )
      log('移动端隐藏匹配列表头', matchHidden === true)
    }

    // 访问口令流程（局域网模式）
    if (LOCKED) {
      console.log('\n=== 访问口令流程 ===')
      const gate = await evaluate("!!document.querySelector('.unlock-card')")
      log('显示访问口令页', gate === true)

      const wrongErr = await evaluate(
        `(async () => {
           const i = document.querySelector('.unlock-input')
           const b = document.querySelector('.unlock-card .btn')
           if (!i || !b) return '(no-input)'
           i.value = '000000'
           i.dispatchEvent(new Event('input', { bubbles: true }))
           b.click()
           for (let k = 0; k < 25; k++) {
             await new Promise(r => setTimeout(r, 200))
             const e = document.querySelector('.unlock-error')
             if (e && e.textContent.trim()) return e.textContent.trim()
           }
           return '(no-error)'
         })()`,
        { awaitPromise: true }
      )
      log('错误口令给出提示', /口令|不正确/.test(wrongErr), wrongErr)

      const code = process.env.BMP_ACCESS_CODE || ''
      const unlocked = await evaluate(
        `(async () => {
           const i = document.querySelector('.unlock-input')
           const b = document.querySelector('.unlock-card .btn')
           if (!i || !b) return false
           i.value = ${JSON.stringify(code)}
           i.dispatchEvent(new Event('input', { bubbles: true }))
           b.click()
           for (let k = 0; k < 60; k++) {
             await new Promise(r => setTimeout(r, 250))
             if (!document.querySelector('.unlock-card')) return true
           }
           return false
         })()`,
        { awaitPromise: true }
      )
      log('正确口令后进入应用', unlocked === true)

      const pingAfter = await evaluate("fetch('/auth-api/ping').then(r=>r.json()).then(j=>j.authed).catch(()=>false)", {
        awaitPromise: true,
      })
      log('解锁后 ping.authed=true', pingAfter === true)
    }

    // 打开登录弹窗 → 二维码能否生成；再验证能关闭（之前修过的 bug）
    // 局域网未解锁时 /auth-api 全部 401，这一段跳过
    if (!LOCKED) {
      // 二维码由服务端访问腾讯登录页生成，网络抖动时会失败 → 重试一次，仍失败则记 SKIP
      const tryQr = () =>
        evaluate(
          `(async () => {
             const entry = [...document.querySelectorAll('.login-entry .btn')].find(b => /登录/.test(b.textContent))
             if (entry) entry.click()
             else {
               const refresh = [...document.querySelectorAll('.login-dialog .btn')].find(b => /刷新二维码/.test(b.textContent))
               if (refresh) refresh.click()
             }
             for (let i = 0; i < 120; i++) {
               await new Promise(r => setTimeout(r, 250))
               const img = document.querySelector('.qr-img')
               if (img && img.src && img.src.startsWith('data:image/png')) return { step: 'qr-ok' }
               const st = document.querySelector('.login-status')?.textContent || ''
               if (st && !/生成/.test(st)) return { step: 'status:' + st.slice(0, 60) }
             }
             return { step: 'timeout' }
           })()`,
          { awaitPromise: true }
        )

      let qr = await tryQr()
      if (qr?.step !== 'qr-ok') {
        await sleep(1500)
        qr = await tryQr()
      }
      const qrFlake = /timeout|fetch failed|Failed to fetch|超时|50[0234]/.test(String(qr?.step || ''))
      if (qr?.step === 'qr-ok') {
        log('打开登录框并生成二维码', true, JSON.stringify(qr))
      } else if (qrFlake) {
        console.log(`SKIP  打开登录框并生成二维码（网络抖动：${qr?.step}）`)
      } else {
        log('打开登录框并生成二维码', false, JSON.stringify(qr))
      }

      // 无论成败都关掉弹窗，避免影响后续步骤
      const closed = await evaluate(
        `(async () => {
           const btn = document.querySelector('.login-dialog .dialog-head .icon-btn')
           if (!btn) return true
           btn.click()
           await new Promise(r => setTimeout(r, 400))
           return !document.querySelector('.login-dialog')
         })()`,
        { awaitPromise: true }
      )
      log('登录弹窗可通过 × 关闭', closed === true)

      // 手动 Cookie 页：剪贴板导入 + 书签小工具（移动端没有 F12 时的替代方案）
      const cookieTab = await evaluate(
        `(async () => {
           const entry = [...document.querySelectorAll('.login-entry .btn')].find(b => /登录/.test(b.textContent))
           if (entry) entry.click()
           for (let i = 0; i < 40; i++) {
             await new Promise(r => setTimeout(r, 250))
             if (document.querySelector('.login-tabs')) break
           }
           const tab = [...document.querySelectorAll('.login-tab')].find(t => /手动 Cookie/.test(t.textContent))
           if (!tab) return { step: 'no-tab' }
           tab.click()
           await new Promise(r => setTimeout(r, 500))
           const btns = [...document.querySelectorAll('.login-dialog button')].map(b => b.textContent.trim())
           const bm = document.querySelector('.bm-code')
           const close = document.querySelector('.login-dialog .dialog-head .icon-btn')
           if (close) close.click()
           return {
             step: 'ok',
             hasPaste: btns.some(t => /从剪贴板粘贴/.test(t)),
             hasBm: btns.some(t => /书签小工具/.test(t)),
             bmValue: bm ? bm.value.slice(0, 24) : '',
             bmHasKey: bm ? /qqmusic_key/.test(bm.value) : false,
           }
         })()`,
        { awaitPromise: true }
      )
      log('手动 Cookie 页有「从剪贴板粘贴」', cookieTab?.hasPaste === true, JSON.stringify(cookieTab))
      log('手动 Cookie 页有书签小工具（含 qqmusic_key）', cookieTab?.hasBm === true && cookieTab?.bmHasKey === true, cookieTab?.bmValue)

      // ── 登录健壮性 F1–F3（离线 mock，不依赖外网）────────────────────────
      // 背景：轮询一错即永久停止 / 二维码生成失败无重试（英文报错直出）/ 回前台不补轮询
      const openLoginDialog = () =>
        evaluate(
          `(async () => {
             const entry = [...document.querySelectorAll('.login-entry .btn')].find(b => /登录/.test(b.textContent))
             if (!entry) return false
             entry.click()
             for (let i = 0; i < 40; i++) {
               await new Promise(r => setTimeout(r, 250))
               if (document.querySelector('.login-dialog .qr-img')) return true
             }
             return false
           })()`,
          { awaitPromise: true }
        )
      const closeLoginDialog = () =>
        evaluate(
          `(async () => {
             const btn = document.querySelector('.login-dialog .dialog-head .icon-btn')
             if (btn) btn.click()
             await new Promise(r => setTimeout(r, 300))
             return !document.querySelector('.login-dialog')
           })()`,
          { awaitPromise: true }
        )

      {
        await enableFetchMock()

        // F1：轮询前两次网络失败 → 提示「正在重试」且不中断，随后自动恢复到扫码等待
        const qr1 = mockAuthQr({ pollFailFirst: 2 })
        const opened1 = await openLoginDialog()
        const sample1 = await evaluate(
          `(async () => {
             const st = () => document.querySelector('.login-dialog .login-status')?.textContent?.trim() || ''
             let hadRetry = false
             for (let i = 0; i < 40 && !hadRetry; i++) {
               await new Promise(r => setTimeout(r, 200))
               if (/正在重试/.test(st())) hadRetry = true
             }
             let recovered = false
             for (let i = 0; i < 40 && !recovered; i++) {
               await new Promise(r => setTimeout(r, 200))
               if (/扫码/.test(st()) && !/正在重试/.test(st())) recovered = true
             }
             const mask = document.querySelector('.login-dialog .qr-mask')?.textContent?.trim() || ''
             return { hadRetry, recovered, last: st(), mask }
           })()`,
          { awaitPromise: true }
        )
        log(
          '登录轮询遇网络异常自动重试（提示重试且不中断）',
          opened1 === true && qr1.pollCalls >= 3 && sample1.hadRetry === true,
          JSON.stringify({ polls: qr1.pollCalls, hadRetry: sample1.hadRetry })
        )
        log(
          '轮询恢复后回到扫码等待（未落错误态）',
          sample1.recovered === true && !/出错/.test(sample1.mask),
          JSON.stringify(sample1)
        )
        await closeLoginDialog()

        // F2：二维码前两次生成网络失败 → 自动退避重试，第三次成功出图（无需手动刷新）
        const qr2 = mockAuthQr({ startFailFirst: 2 })
        const opened2 = await openLoginDialog()
        log(
          '二维码生成失败自动重试后成功出图',
          opened2 === true && qr2.startCalls === 3,
          JSON.stringify({ startCalls: qr2.startCalls })
        )
        await closeLoginDialog()

        // F3：轮询连续失败到终态（轮询停止）→ 回到前台立即补轮询并自动恢复
        const qr3 = mockAuthQr()
        qr3.pollMode = 'error'
        const opened3 = await openLoginDialog()
        const reachedTerminal = await evaluate(
          `(async () => {
             const mask = () => document.querySelector('.login-dialog .qr-mask')?.textContent?.trim() || ''
             for (let i = 0; i < 80; i++) {
               await new Promise(r => setTimeout(r, 250))
               // 只有错误遮罩「出错」才代表重试耗尽（重试期间状态仍是 waiting 且有「异常」文案）
               if (/出错/.test(mask())) return true
             }
             return false
           })()`,
          { awaitPromise: true }
        )
        const pollsBeforeResume = qr3.pollCalls
        await sleep(2000)
        const pollingStopped = qr3.pollCalls === pollsBeforeResume
        qr3.pollMode = 'waiting'
        await evaluate(
          `(() => {
             Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
             document.dispatchEvent(new Event('visibilitychange'))
             return true
           })()`
        )
        const resumed = await evaluate(
          `(async () => {
             const st = () => document.querySelector('.login-dialog .login-status')?.textContent?.trim() || ''
             for (let i = 0; i < 20; i++) {
               await new Promise(r => setTimeout(r, 200))
               if (/扫码/.test(st()) && !/正在重试/.test(st())) return st()
             }
             return ''
           })()`,
          { awaitPromise: true }
        )
        log(
          '回到前台补轮询（终态自动恢复扫码等待）',
          opened3 === true && reachedTerminal === true && pollingStopped === true && qr3.pollCalls > pollsBeforeResume && Boolean(resumed),
          JSON.stringify({ reachedTerminal, pollingStopped, before: pollsBeforeResume, after: qr3.pollCalls, resumed })
        )
        await closeLoginDialog()
        clearAuthQrMocks()
      }
    }

    // 设置里显示版本/构建时间（用于确认页面是否刷新到最新代码）
    const ver = await evaluate(
      `(async () => {
         const btn = [...document.querySelectorAll('.icon-btn')].find(b => /设置/.test(b.title || ''))
         if (!btn) return ''
         btn.click()
         await new Promise(r => setTimeout(r, 500))
         const t = document.querySelector('.app-version')?.textContent?.replace(/\\s+/g, ' ').trim() || ''
         const close = document.querySelector('.dialog .dialog-head .icon-btn')
         if (close) close.click()
         await new Promise(r => setTimeout(r, 300))
         return t
       })()`,
      { awaitPromise: true }
    )
    log('设置里显示版本与构建时间', /版本 v\d/.test(ver) && /构建/.test(ver), ver)

    // 局域网模式会有“故意的 401”；Clash/代理抖动时上游超时会让本地代理返回 5xx。
    // 这几类属于环境噪声，不计入失败，但会打印计数，避免掩盖真实问题。
    const NET_NOISE_STATUS = '(401|500|502|503|504)'
    const isNetNoise = (s) =>
      isSentinelHit(s) ||
      new RegExp(
        ` ${NET_NOISE_STATUS} |Failed to load resource: the server responded with a status of ${NET_NOISE_STATUS}|net::ERR_|Failed to fetch|QQ音乐接口请求失败|B 站请求|没有可用的音源|超时`
      ).test(s)
    const ignoredConsole = consoleErrors.filter(isNetNoise).length
    const ignoredFailed = failedRequests.filter((r) => new RegExp(`^${NET_NOISE_STATUS} `).test(r) || isSentinelHit(r)).length
    const relevantConsole = consoleErrors.filter((e) => !isNetNoise(e))
    const relevantFailed = failedRequests.filter(
      (r) => !new RegExp(`^${NET_NOISE_STATUS} `).test(r) && !isSentinelHit(r)
    )
    if (ignoredConsole || ignoredFailed) {
      console.log(`    （已忽略 ${ignoredFailed} 个网络相关 4xx/5xx、${ignoredConsole} 条相关控制台报错）`)
    }
    log('无 JS 异常 / console.error', relevantConsole.length === 0, relevantConsole.slice(0, 3).join(' | '))
    log('无 4xx/5xx 资源请求', relevantFailed.length === 0, relevantFailed.slice(0, 5).join(' | '))

    // ---------- 登录态 ----------
    if (LOGGED_IN) {
      const cookie = (process.env.BMP_COOKIE || '').trim()
      console.log('\n=== 登录态流程 ===')
      if (DEMO) {
        // 演示模式：注入合成的「我喜欢」缓存，无需任何凭据即可验证播放器
        // 演示模式必须完全不依赖外部网络（否则上游抖动会把用例判成失败）：
        // 封面统一用同源静态资源；demo3 故意用不存在的地址，用来验证「失败重试 + 音符占位」
        const LOCAL_COVER = '/favicon.svg'
        const BROKEN_COVER = '/' + BROKEN_COVER_SENTINEL + '.png'
        const demoSongs = [
          { id: 'demo1', mid: '', name: '晴天', singers: ['周杰伦'], album: '', albumMid: '', cover: '', interval: 269, mvVid: '' },
          {
            id: 'demo2',
            mid: '',
            name: '稻香',
            singers: ['周杰伦'],
            album: '',
            albumMid: '',
            cover: LOCAL_COVER,
            interval: 223,
            mvVid: '',
          },
          {
            id: 'demo3',
            mid: '',
            name: '测试歌曲 3',
            singers: ['测试歌手'],
            album: '',
            albumMid: '',
            cover: BROKEN_COVER,
            interval: 200,
            mvVid: '',
          },
          ...Array.from({ length: 37 }, (_, i) => ({
            id: 'demo' + (i + 4),
            mid: '',
            name: `测试歌曲 ${i + 4}`,
            singers: ['测试歌手'],
            album: '',
            albumMid: '',
            cover: '',
            interval: 200,
            mvVid: '',
          })),
        ]
        const likedTotal = demoSongs.length
        // 注入一条合成匹配（真实 BV 号），让播放流程不依赖 B站搜索，测试更稳定
        const demoMatches = {
          demo1: {
            status: 'ok',
            bvid: 'BV1d4411N7zD',
            title: '【4K修复】周杰伦 - 晴天MV',
            author: 'demo',
            play: 1000000,
            duration: '4:29',
            cover: LOCAL_COVER,
            url: 'https://www.bilibili.com/video/BV1d4411N7zD',
            keyword: '晴天 周杰伦',
            manual: false,
          },
        }
        await evaluate(
          `(() => {
             localStorage.setItem('bmp:config', JSON.stringify({ qqCookie: 'uin=o10000; qm_keyst=DEMOKEY; demo=1', biliCookie: '', uin: '10000', euin: '', playMode: 'order' }))
             localStorage.setItem('bmp:user', JSON.stringify({ uin: '10000', nickname: 'QQ 10000', avatar: '', vip: 0 }))
             localStorage.setItem('bmp:userdata', JSON.stringify({
               uin: '10000', likedTotal: ${likedTotal}, likedCount: ${likedTotal}, albumTotal: 0, albums: [], playlists: [],
               likedSongs: ${JSON.stringify(demoSongs)},
             }))
                 localStorage.setItem('bmp:matches', JSON.stringify(${JSON.stringify(demoMatches)}))
                 // 注入一段已恢复的队列（queueIndex 有效但 player.index = -1）：
                 // 验证「重启后点迷你播放条仍能打开全屏播放器」
                 localStorage.setItem('bmp:queue', JSON.stringify({ songs: ${JSON.stringify(demoSongs.slice(0, 2))}, index: 0, savedAt: Date.now() }))
                 // 注入歌词缓存（纯本地命中，不发网络请求）：v3 含逐字（QRC words）与罗马音/翻译
                 // demo1：重启恢复队列的歌曲；0039MnYb0qxYhV：搜索 fixture「晴天」的 mid
                 for (const lk of ['bmp:lyric4:demo1', 'bmp:lyric4:0039MnYb0qxYhV']) {
                   localStorage.setItem(lk, JSON.stringify({ qrc: true, lines: ${JSON.stringify([
                     {
                       time: 0,
                       duration: 4,
                       text: '第一句歌词',
                       trans: 'First line',
                       roma: 'dai ichi ku',
                       words: [
                         { text: '第', time: 0, duration: 1 },
                         { text: '一', time: 1, duration: 1 },
                         { text: '句', time: 2, duration: 1 },
                         { text: '歌', time: 3, duration: 1 },
                         { text: '词', time: 3.5, duration: 0.5 },
                       ],
                     },
                     { time: 30, duration: 4, text: '第二句歌词', words: [{ text: '第', time: 30, duration: 1 }, { text: '二', time: 31, duration: 1 }, { text: '句', time: 32, duration: 2 }] },
                     { time: 60, duration: 4, text: '第三句歌词' },
                     { time: 120, duration: 4, text: '第四句歌词' },
                   ])}, savedAt: Date.now() }))
                 }
                 // 清掉上次运行残留的音源偏好，保证「默认 B 站」等断言可重复
                 localStorage.removeItem('bmp:source-pref')
                 return true
           })()`
        )
        await send('Page.reload')
        await sleep(1200)
        log('演示模式：注入合成歌单', true, `${likedTotal} 首`)

        // 重启恢复队列（player.index = -1）时：迷你播放条仍应能打开全屏播放器；
        // 全屏播放器默认显示歌词（P2.5），切换后记住选择
        const restored = await evaluate(
          `(async () => {
             const sleep = (ms) => new Promise(r => setTimeout(r, ms))
             const title = document.querySelector('.np-title')?.textContent?.trim() || ''
             document.querySelector('.player .now-playing')?.click()
             await sleep(500)
             const full = !!document.querySelector('.now-playing-full')
             // 队列已恢复但主列表为空：播放键不能被禁用（否则重启后无法开播）
             const playDisabled = !!document.querySelector('.np-play')?.disabled
             // 默认歌词视图
             const defaultLyrics = !!document.querySelector('.np-lyric-wrap') && !document.querySelector('.np-cover-wrap')
             const pref0 = localStorage.getItem('bmp:lyric-view')
             // 切到封面 → 记住
             const btn = [...document.querySelectorAll('.np-top .icon-btn')].find(b => /封面|歌词/.test(b.title || ''))
             btn?.click()
             await sleep(400)
             const coverShown = !!document.querySelector('.np-cover-wrap')
             const prefCover = localStorage.getItem('bmp:lyric-view')
             document.querySelector('.np-top .icon-btn')?.click()
             await sleep(300)
             // 重开：仍是封面
             document.querySelector('.player .now-playing')?.click()
             await sleep(500)
             const coverRemembered = !!document.querySelector('.np-cover-wrap') && !document.querySelector('.np-lyric-wrap')
             // 切回歌词 → 记住
             const btn2 = [...document.querySelectorAll('.np-top .icon-btn')].find(b => /封面|歌词/.test(b.title || ''))
             btn2?.click()
             await sleep(400)
             const lyricsBack = !!document.querySelector('.np-lyric-wrap')
             document.querySelector('.np-top .icon-btn')?.click()
             await sleep(300)
             document.querySelector('.player .now-playing')?.click()
             await sleep(500)
             const lyricsRemembered = !!document.querySelector('.np-lyric-wrap') && !document.querySelector('.np-cover-wrap')
             document.querySelector('.np-top .icon-btn')?.click()
             await sleep(300)
             return { title, full, playDisabled, defaultLyrics, pref0, coverShown, prefCover, coverRemembered, lyricsBack, lyricsRemembered, collapsed: !document.querySelector('.now-playing-full') }
           })()`,
          { awaitPromise: true }
        )
        log(
          '恢复队列后仍可打开全屏播放器且播放键可用',
          restored.full === true && restored.collapsed === true && restored.playDisabled === false,
          JSON.stringify(restored)
        )
        log('全屏播放器默认显示歌词', restored.defaultLyrics === true, JSON.stringify({ defaultLyrics: restored.defaultLyrics, pref0: restored.pref0 }))
        log(
          '切到封面后记住选择',
          restored.coverShown === true && restored.coverRemembered === true && /^(0|false)$/.test(restored.prefCover || ''),
          JSON.stringify({ coverShown: restored.coverShown, coverRemembered: restored.coverRemembered, pref: restored.prefCover })
        )
        log(
          '切回歌词后同样记住',
          restored.lyricsBack === true && restored.lyricsRemembered === true,
          JSON.stringify({ lyricsBack: restored.lyricsBack, lyricsRemembered: restored.lyricsRemembered })
        )
      } else if (!cookie) {
        log('已提供 Cookie', false, '未设置 BMP_COOKIE（或改用 --demo）')
      } else {
        const uin =
          ((cookie.match(/(?:^|;\s*)(?:uin|p_uin|pt2gguin|superuin|wxuin)=(o?\d{5,})/i) || [])[1] || '').replace(
            /^o/i,
            ''
          )
        log('已提供登录 Cookie', true, `长度 ${cookie.length}`)
        log('从 Cookie 解析出 QQ 号', /^\d{5,}$/.test(uin), uin || '(空)')
        await evaluate(
          `(() => {
             const cfg = { qqCookie: ${JSON.stringify(cookie)}, biliCookie: '', uin: ${JSON.stringify(uin)}, playMode: 'order' }
             localStorage.setItem('bmp:config', JSON.stringify(cfg))
             localStorage.setItem('bmp:user', JSON.stringify({ uin: ${JSON.stringify(uin)}, nickname: 'QQ ' + ${JSON.stringify(uin)}, avatar: '', vip: 0 }))
             return true
           })()`
        )
        await send('Page.reload')
        await sleep(1000)
      }

      if (DEMO || cookie) {
        // 等待「我喜欢」数量出现（或超时）
        const liked = await evaluate(
          `(async () => {
             for (let i = 0; i < 80; i++) {
               const t = document.querySelector('.liked-item .pi-sub')?.textContent?.trim() || ''
               if (t && !/加载中/.test(t)) return t
               await new Promise(r => setTimeout(r, 500))
             }
             return '(timeout)'
           })()`,
          { awaitPromise: true }
        )
        log('「我喜欢的音乐」数量加载', /\d+\s*首/.test(liked), liked)

        const albumHeader = await evaluate(
          `[...document.querySelectorAll('.side-label')].map(e => e.textContent.trim()).find(t => /收藏的专辑/.test(t)) || ''`
        )
        if (DEMO) console.log(`SKIP  「收藏的专辑」分组（演示模式无专辑数据）`)
        else log('「收藏的专辑」分组出现', /收藏的专辑/.test(albumHeader), albumHeader)

        const userCard = await evaluate("document.querySelector('.user-name')?.textContent?.trim() || ''")
        log('用户卡片显示昵称', /QQ\s*\S+/.test(userCard), userCard)

        // 打开我喜欢 → 应出现歌曲行
        const rows = await evaluate(
          `(async () => {
             const item = document.querySelector('.liked-item')
             if (!item) return -1
             item.click()
             for (let i = 0; i < 80; i++) {
               const n = document.querySelectorAll('.song-row').length
               if (n > 0) return n
               await new Promise(r => setTimeout(r, 500))
             }
             return 0
           })()`,
          { awaitPromise: true }
        )
        log('点击「我喜欢」后渲染歌曲列表', rows > 0, `${rows} 行`)

        if (rows > 0) {
          if (DEMO) {
            // 行内封面四种情况（对应「图 3 某首歌没图片」的修复）：
            //  demo1 晴天：QQ 无封面 + 有匹配 → 用匹配到的封面
            //  demo2 稻香：有 QQ 封面 → 用自身封面
            //  demo3：封面地址不存在 → 先给一次重试机会，重试后仍失败才显示音符占位
            //  demo4：没有封面也没有匹配 → 立即显示音符占位（img 无 src）
            const readCovers = () =>
              evaluate(
                `(() => {
                   const rows = [...document.querySelectorAll('.song-row')].slice(0, 4)
                   return rows.map((r) => {
                     const img = r.querySelector('.track img')
                     return {
                       name: r.querySelector('.t-name')?.textContent?.trim() || '',
                       src: img ? img.getAttribute('src') || '' : '(no-img)',
                       ph: !!img && img.classList.contains('ph'),
                     }
                   })
                 })()`
              )
            const covers = await readCovers()
            const c0 = covers[0] || {}
            const c1 = covers[1] || {}
            const c2 = covers[2] || {}
            const c3 = covers[3] || {}
            log('无 QQ 封面时行内回退到匹配封面', c0.src !== '', JSON.stringify(c0))
            log('有 QQ 封面时用自身封面', c1.src !== '', JSON.stringify(c1))
            log('封面失效时先不显示占位（留给重试）', c2.src !== '' && c2.ph === false, JSON.stringify(c2))
            await sleep(2600) // 1.2s 后重建 <img> 重试一次，仍失败才落占位
            const afterRetry = (await readCovers())[2] || {}
            log('重试后仍失败才显示音符占位', afterRetry.ph === true, JSON.stringify(afterRetry))
            log(
              '无封面也无匹配时立即显示音符占位（透明像素 + 音符底色）',
              c3.ph === true && c3.src.startsWith('data:image/gif'),
              JSON.stringify(c3)
            )
            // demo1 晴天 是「封面来自 B站匹配」的情况：桌面端右侧匹配区已有同一张图，
            // 行内不该重复显示；移动端没有匹配区，行内必须保留。
            const dupDisplay = await evaluate(
              `(() => {
                 const img = [...document.querySelectorAll('.song-row')][0]?.querySelector('.track img')
                 return img ? getComputedStyle(img).display : '(no-img)'
               })()`
            )
            if (MOBILE) log('移动端保留匹配回退的封面（无匹配区）', dupDisplay === 'block', dupDisplay)
            else log('桌面端不重复显示匹配回退的封面', dupDisplay === 'none', dupDisplay)
          }

          // 列表行的操作按钮：桌面 hover 才出；移动端常显「喜欢/下载/更多」，次要操作收进「更多」面板
          const rematch = await evaluate(
            `(() => {
               const btn = document.querySelector('.song-row .row-actions .mobile-only')
               const more = [...document.querySelectorAll('.song-row .row-actions .mobile-only')].find(b => /更多操作/.test(b.title || ''))
               if (!btn) return { hasBtn: false }
               const r = btn.getBoundingClientRect()
               return {
                 hasBtn: true, display: getComputedStyle(btn).display,
                 w: Math.round(r.width), h: Math.round(r.height), title: btn.title || '',
                 hasMore: !!more, moreDisplay: more ? getComputedStyle(more).display : '',
               }
             })()`
          )
          if (MOBILE) {
            log(
              '移动端列表行常显操作（喜欢/下载/更多）',
              rematch.hasBtn === true && rematch.w > 0 && rematch.h > 0 && rematch.hasMore === true && rematch.moreDisplay !== 'none',
              JSON.stringify(rematch)
            )
            // 「更多」面板：重新匹配 / 加入歌单 / 下一首播放（+ 取消）
            const sheet = await evaluate(
              `(async () => {
                 const sleep = (ms) => new Promise(r => setTimeout(r, ms))
                 const wait = async (fn, tries = 40) => { for (let i = 0; i < tries; i++) { await sleep(200); const v = fn(); if (v) return v } return null }
                 const more = [...document.querySelectorAll('.song-row .row-actions .mobile-only')].find(b => /更多操作/.test(b.title || ''))
                 more?.click()
                 await wait(() => document.querySelector('.action-sheet'))
                 const items = [...document.querySelectorAll('.action-sheet .as-item')].map(b => b.textContent.trim())
                 const title = document.querySelector('.action-sheet .as-title')?.textContent?.trim() || ''
                 const cancel = [...document.querySelectorAll('.action-sheet .as-item')].find(b => /取消/.test(b.textContent))
                 cancel?.click()
                 await sleep(300)
                 const closed = !document.querySelector('.action-sheet')
                 return { items, title, closed }
               })()`,
              { awaitPromise: true }
            )
            log(
              '移动端「更多」动作面板（重新匹配/加入歌单/下一首播放 + 取消）',
              sheet.items.some((t) => /重新匹配/.test(t)) &&
                sheet.items.some((t) => /加入歌单/.test(t)) &&
                sheet.items.some((t) => /下一首播放/.test(t)) &&
                sheet.items.some((t) => /取消/.test(t)) &&
                sheet.closed === true,
              JSON.stringify(sheet)
            )
          } else {
            log(
              '桌面端行内操作仍为 hover 显示（不常显）',
              rematch.hasBtn === true && rematch.display === 'none',
              JSON.stringify(rematch)
            )
          }

          const PAUSE_D = 'M6 5h4v14H6z'
          const PLAY_D = 'M8 5'
          const iconState = async () =>
            evaluate(`(document.querySelector('.ctrl.play svg path')?.getAttribute('d') || '')`)

          log('未播放时无定位按钮', (await evaluate("!!document.querySelector('.float-btn.locate')")) === false)

          // 点整行（track 区域）应直接播放，而不是只能点小按钮
          const rowClick = await evaluate(
            `(async () => {
               const track = document.querySelector('.song-row .track')
               if (!track) return { clicked: false }
               let noSource = false
               for (let attempt = 0; attempt < 3; attempt++) {
                 track.click()
                 for (let i = 0; i < 30; i++) {
                   await new Promise(r => setTimeout(r, 300))
                   const d = document.querySelector('.ctrl.play svg path')?.getAttribute('d') || ''
                   if (d.startsWith('M6 5h4')) {
                     return {
                       clicked: true, playing: true, attempt,
                       active: !!document.querySelector('.song-row.active'),
                       title: document.querySelector('.np-title')?.textContent?.trim() || '',
                     }
                   }
                   const toast = document.querySelector('.toast.error')?.textContent || ''
                   if (/没有可用的音源/.test(toast)) noSource = true
                 }
                 if (noSource) break
               }
               return {
                 clicked: true, playing: false, noSource,
                 active: !!document.querySelector('.song-row.active'),
                 title: document.querySelector('.np-title')?.textContent?.trim() || '',
               }
             })()`,
            { awaitPromise: true }
          )
          log('点歌曲行成为当前歌曲', rowClick.clicked === true && rowClick.active === true, JSON.stringify(rowClick))
          if (rowClick.playing) {
            log('点歌曲行可直接播放', true, JSON.stringify(rowClick))
          } else {
            console.log('SKIP  点歌曲行可直接播放（本次未匹配到可用音源，属网络/匹配问题）')
            console.log('SKIP  其余依赖播放的断言（定位按钮 / 音源 / 全屏播放器 / 播放模式）')
          }

          if (rowClick.playing) {
          // 定位按钮：播放后出现，点击可滚到当前行
          const located = await evaluate(
            `(async () => {
               const btn = document.querySelector('.float-btn.locate')
               if (!btn) return { hasBtn: false }
               const content = document.querySelector('.content')
               content.scrollTop = content.scrollHeight
               await new Promise(r => setTimeout(r, 400))
               const before = document.querySelector('.song-row.active')?.getBoundingClientRect()
               btn.click()
               await new Promise(r => setTimeout(r, 1000))
               const el = document.querySelector('.song-row.active')
               const r = el && el.getBoundingClientRect()
               const c = content.getBoundingClientRect()
               const visible = !!r && r.top >= c.top - 2 && r.bottom <= c.bottom + 2
               return {
                 hasBtn: true, visible,
                 flashed: !!el && el.classList.contains('locate-flash'),
                 beforeTop: before && Math.round(before.top), afterTop: r && Math.round(r.top),
               }
             })()`,
            { awaitPromise: true }
          )
          log('播放后出现定位按钮', located.hasBtn === true, JSON.stringify(located))
          log('点定位按钮滚到当前播放行并高亮', located.visible === true && located.flashed === true, JSON.stringify(located))

          // 返回顶部按钮：滚出一屏后出现，点击回到顶部
          const backTop = await evaluate(
            `(async () => {
               const findBtn = () => [...document.querySelectorAll('.float-btn')].find(b => /返回顶部/.test(b.title || ''))
               const content = document.querySelector('.content')
               content.scrollTop = 0
               await new Promise(r => setTimeout(r, 400))
               const hiddenAtTop = !findBtn()
               content.scrollTop = content.scrollHeight
               await new Promise(r => setTimeout(r, 500))
               const shownWhenScrolled = !!findBtn()
               findBtn()?.click()
               await new Promise(r => setTimeout(r, 1200))
               const topAfter = Math.round(content.scrollTop)
               const hiddenAfter = !findBtn()
               return { hiddenAtTop, shownWhenScrolled, topAfter, hiddenAfter }
             })()`,
            { awaitPromise: true }
          )
          log('顶部时无返回顶部按钮', backTop.hiddenAtTop === true, JSON.stringify(backTop))
          log('滚出第一屏后出现返回顶部按钮', backTop.shownWhenScrolled === true, JSON.stringify(backTop))
          log('点返回顶部回到顶部并隐藏按钮', backTop.topAfter <= 2 && backTop.hiddenAfter === true, JSON.stringify(backTop))

          // 操作区（含 B站 按钮）不应误触播放
          const actionsStop = await evaluate(
            `(async () => {
               const playBtn = document.querySelector('.ctrl.play')
               if (playBtn) playBtn.click() // 暂停
               await new Promise(r => setTimeout(r, 700))
               const pausedBefore = (document.querySelector('.ctrl.play svg path')?.getAttribute('d') || '').startsWith('M8 5')
               document.querySelector('.song-row .row-actions')?.click()
               await new Promise(r => setTimeout(r, 900))
               const stillPaused = (document.querySelector('.ctrl.play svg path')?.getAttribute('d') || '').startsWith('M8 5')
               return { pausedBefore, stillPaused }
             })()`,
            { awaitPromise: true }
          )
          log('点操作区不会误触播放', actionsStop.pausedBefore === true && actionsStop.stillPaused === true, JSON.stringify(actionsStop))

          const subBefore = await evaluate("document.querySelector('.np-sub')?.textContent?.trim() || ''")
          // 再点小播放按钮继续播放，验证音源
          await evaluate(
            `(() => { const b = document.querySelector('.song-row .play-mini'); if (b) b.click(); return true })()`
          )
          // 等音源确定（B站匹配 + 音频地址获取，网络慢时可能要几十秒），避免偶发失败
          await evaluate(
            `(async () => {
               for (let i = 0; i < 120; i++) {
                 const t = document.querySelector('.np-sub')?.textContent || ''
                 if (/QQ音乐音源|B站音源|内嵌播放/.test(t)) return t
                 await new Promise(r => setTimeout(r, 300))
               }
               return document.querySelector('.np-sub')?.textContent || ''
             })()`,
            { awaitPromise: true }
          )
          const subAfter = await evaluate("document.querySelector('.np-sub')?.textContent?.trim() || ''")
          const npTitle = await evaluate("document.querySelector('.np-title')?.textContent?.trim() || ''")
          const source = /QQ音乐音源/.test(subAfter) ? 'QQ音乐音源' : /B站音源/.test(subAfter) ? 'B站音源' : /内嵌播放/.test(subAfter) ? '内嵌播放' : '(未知)'
          log('点击播放后底部播放条更新', npTitle.length > 0, `曲目=${npTitle}`)
          log('音源已确定（QQ/B站/内嵌之一）', source !== '(未知)', `音源=${source} | ${subAfter}`)

          // 音源偏好：默认 B 站，可在播放器上切换并记住
          {
            const srcPref = await evaluate(
              `(() => {
                 const btn = document.querySelector('.player .src-btn')
                 if (!btn) return { found: false }
                 const before = btn.textContent.trim()
                 const beforeClass = btn.className
                 btn.click()
                 return { found: true, before, beforeClass, stored: localStorage.getItem('bmp:source-pref') }
               })()`
            )
            log('播放条有音源切换按钮', srcPref?.found === true, JSON.stringify(srcPref))
            if (srcPref?.found) {
              log('音源按钮显示当前音源', /B站|QQ音乐/.test(srcPref.before), srcPref.before)
              log('默认音源为 B 站', /B站/.test(srcPref.before) && /bili/.test(srcPref.beforeClass), srcPref.before)
              await new Promise((r) => setTimeout(r, 1200))
              const after = await evaluate(
                `(() => {
                   const btn = document.querySelector('.player .src-btn')
                   return { text: btn ? btn.textContent.trim() : '', cls: btn ? btn.className : '', stored: localStorage.getItem('bmp:source-pref') || '' }
                 })()`
              )
              log('点击后切换到另一个音源', after?.text !== srcPref.before, `${srcPref.before} → ${after?.text}`)
              const expectKey = /QQ音乐/.test(after?.text || '') ? 'qq' : 'bili'
              log('单曲音源偏好已记住（localStorage）', after?.stored?.includes(`"${expectKey}"`), after?.stored)
              // 切回，避免影响后续断言
              await evaluate("document.querySelector('.player .src-btn')?.click(); 'ok'")
              await new Promise((r) => setTimeout(r, 800))
            }
          }

          if (MOBILE) {
            const np = await evaluate(
              `(async () => {
                 const mini = document.querySelector('.player .now-playing')
                 if (!mini) return { open: false, reason: 'no-mini' }
                 mini.click()
                 await new Promise(r => setTimeout(r, 600))
                 return {
                   open: !!document.querySelector('.now-playing-full'),
                   bar: !!document.querySelector('.np-bar'),
                   title: document.querySelector('.np-song')?.textContent?.trim() || '',
                 }
               })()`,
              { awaitPromise: true }
            )
            log('点迷你播放条打开全屏播放器', np.open === true && np.bar === true, JSON.stringify(np))

            const playIcon = await evaluate(
              `(() => {
                 const probe = (btn) => {
                   if (!btn) return { hasBtn: false }
                   const svg = btn.querySelector('svg')
                   if (!svg) return { hasBtn: true, hasSvg: false, html: btn.innerHTML.slice(0, 80) }
                   const path = svg.querySelector('path')
                   const r = svg.getBoundingClientRect()
                   return {
                     hasBtn: true, hasSvg: true, hasPath: !!path, w: Math.round(r.width), h: Math.round(r.height),
                     fill: getComputedStyle(svg).fill, color: getComputedStyle(btn).color, bg: getComputedStyle(btn).backgroundColor,
                   }
                 }
                 return { np: probe(document.querySelector('.np-play')), bar: probe(document.querySelector('.player .ctrl.play')) }
               })()`
            )
            // 图标必须与按钮底色不同：浅色主题曾出现「深底 + 深图标」几乎不可见
            const contrastOk = (p) =>
              p.hasBtn && p.hasSvg && p.hasPath && p.w > 10 && p.fill !== 'rgba(0, 0, 0, 0)' && p.fill !== p.bg
            log(
              '播放键图标可见且与底色有对比（全屏 + 迷你条）',
              contrastOk(playIcon.np || {}) && contrastOk(playIcon.bar || {}),
              JSON.stringify(playIcon)
            )

            const npBar = await evaluate(
              `(() => {
                 const el = document.querySelector('.np-bar')
                 if (!el) return { found: false }
                 const r = el.getBoundingClientRect()
                 return { found: true, w: Math.round(r.width), h: Math.round(r.height), display: getComputedStyle(el).display }
               })()`
            )
            log('全屏播放器进度条可见且有尺寸', npBar.found && npBar.w > 80 && npBar.h >= 2, JSON.stringify(npBar))

            // 全屏播放器里打开搜索弹窗，必须叠在播放器之上
            const layered = await evaluate(
              `(async () => {
                 const sleep = (ms) => new Promise(r => setTimeout(r, ms))
                 // 顶部 toast（top:18px, z-index 100）会盖住探测点，先等它消失（切音源刚弹过）
                 for (let i = 0; i < 24; i++) {
                   if (!document.querySelector('.toasts > *')) break
                   await sleep(250)
                 }
                 const btn = [...document.querySelectorAll('.np-top .icon-btn')].find(b => /搜索/.test(b.title || ''))
                 if (!btn) return { clicked: false }
                 btn.click()
                 for (let i = 0; i < 30; i++) {
                   await new Promise(r => setTimeout(r, 200))
                   if (document.querySelector('.dialog')) break
                 }
                 const dlg = document.querySelector('.dialog')
                 if (!dlg) return { opened: false }
                 const r = dlg.getBoundingClientRect()
                 const top = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + 18))
                 const onTop = !!top && dlg.contains(top)
                 return {
                   opened: true,
                   onTop,
                   z: getComputedStyle(dlg.parentElement).zIndex,
                   rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
                   topInfo: top ? (top.className || top.tagName) + '|' + (top.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 40) : '(null)',
                 }
               })()`,
              { awaitPromise: true }
            )
            log('全屏播放器中搜索弹窗叠在最上层', layered.opened === true && layered.onTop === true, JSON.stringify(layered))

            // 关掉弹窗，避免影响后续断言
            await evaluate(
              `(async () => {
                 const btn = document.querySelector('.dialog .dialog-head .icon-btn')
                 if (btn) btn.click()
                 await new Promise(r => setTimeout(r, 300))
                 return true
               })()`,
              { awaitPromise: true }
            )

            const collapsed = await evaluate(
              `(async () => {
                 const btn = document.querySelector('.np-top .icon-btn')
                 if (!btn) return false
                 btn.click()
                 await new Promise(r => setTimeout(r, 500))
                 return !document.querySelector('.now-playing-full')
               })()`,
              { awaitPromise: true }
            )
            log('全屏播放器可收起', collapsed === true)
          }

          // 播放模式循环
          const modes = await evaluate(
            `(async () => {
               const btn = document.querySelector('.ctrl.mode')
               if (!btn) return []
               const out = []
               for (let i = 0; i < 4; i++) { btn.click(); await new Promise(r => setTimeout(r, 250)); out.push(btn.className) }
               return out
             })()`,
            { awaitPromise: true }
          )
          log('播放模式可切换', Array.isArray(modes) && modes.length === 4, modes.join(' | '))

          // 播放队列面板（P1.1）：打开 / 高亮 / 移出 / 拖动排序 / 清空
          {
            const q = await evaluate(
              `(async () => {
                 const sleep = (ms) => new Promise(r => setTimeout(r, ms))
                 let btn = document.querySelector('.player .queue-btn')
                 let openedFromFull = false
                 if (!btn || btn.offsetParent === null) {
                   document.querySelector('.player .now-playing')?.click()
                   await sleep(500)
                   btn = [...document.querySelectorAll('.np-controls .ctrl')].find(b => /播放队列/.test(b.title || ''))
                   openedFromFull = true
                 }
                 if (!btn) return { found: false }
                 btn.click()
                 await sleep(400)
                 const items = () => [...document.querySelectorAll('.queue-item')]
                 const opened = !!document.querySelector('.queue-panel')
                 // 侧边栏形式：满高、贴右、窄于视口
                 const pr = document.querySelector('.queue-panel')?.getBoundingClientRect()
                 const geom = pr
                   ? {
                       top: Math.round(pr.top),
                       rightGap: Math.round(window.innerWidth - pr.right),
                       w: Math.round(pr.width),
                       h: Math.round(pr.height),
                       vw: window.innerWidth,
                       vh: window.innerHeight,
                     }
                   : null
                 const sideForm =
                   !!pr &&
                   Math.round(pr.top) === 0 &&
                   Math.round(window.innerWidth - pr.right) === 0 &&
                   pr.height >= window.innerHeight - 1 &&
                   pr.width <= window.innerWidth * 0.9
                 const first = items()[0]?.querySelector('.q-name')?.textContent?.trim() || ''
                 const count0 = items().length
                 const activeName = document.querySelector('.queue-item.active .q-name')?.textContent?.trim() || ''
                 const headCount = document.querySelector('.queue-count')?.textContent?.trim() || ''
                 const badge = document.querySelector('.queue-badge')?.textContent?.trim() || ''
                 // 移出最后一项（不碰当前曲）
                 items()[items().length - 1]?.querySelector('.q-remove')?.click()
                 await sleep(300)
                 const count1 = items().length
                 // 拖动排序：第 0 项拖到第 2 项位置
                 const handle = items()[0]?.querySelector('.q-handle')
                 const target = items()[2]?.getBoundingClientRect()
                 if (handle && target) {
                   const hr = handle.getBoundingClientRect()
                   handle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: hr.left + 4, clientY: hr.top + 4 }))
                   window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: target.left + 30, clientY: target.top + 12 }))
                   window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
                   await sleep(300)
                 }
                 const names = items().map(e => e.querySelector('.q-name')?.textContent?.trim() || '')
                 const movedTo = names.indexOf(first)
                 // 清空 + 关闭
                 const clearBtn = [...document.querySelectorAll('.queue-head-actions .btn')].find(b => /清空/.test(b.textContent))
                 clearBtn?.click()
                 await sleep(300)
                 const emptyAfterClear = !!document.querySelector('.queue-empty') && items().length === 0
                 document.querySelector('.queue-head-actions .icon-btn')?.click()
                 await sleep(200)
                 const closed = !document.querySelector('.queue-panel')
                 if (openedFromFull) {
                   document.querySelector('.np-top .icon-btn')?.click()
                   await sleep(300)
                 }
                 return { found: true, opened, closed, count0, activeName, headCount, badge, count1, movedTo, emptyAfterClear, first, sideForm, geom, usedPlayerBar: !openedFromFull }
               })()`,
              { awaitPromise: true }
            )
            log('播放队列面板可打开且条目完整', q.found && q.opened && q.count0 === 40 && q.headCount === '40', JSON.stringify(q))
            log('播放队列为右侧边栏形式（满高 + 贴右 + 窄于视口）', q.found && q.sideForm === true, JSON.stringify(q.geom))
            log('播放条右下有队列入口（移动端同样可见）', q.found && q.usedPlayerBar === true, JSON.stringify({ usedPlayerBar: q.usedPlayerBar }))
            log('队列高亮当前播放曲', q.activeName.length > 0, q.activeName)
            log('播放条队列角标显示数量', q.badge === '40', q.badge)
            log('移出队列一项', q.count1 === 39, `${q.count0} → ${q.count1}`)
            log('拖动排序生效', q.movedTo === 2, `first=${q.first} → index ${q.movedTo}`)
            log('清空队列', q.emptyAfterClear === true)
            log('队列面板可关闭', q.closed === true)
          }

          // 最近播放（纯本地）：播放后入历史 → 进入页面 → 本地队列播放 → 二次确认清空
          {
            const h = await evaluate(
              `(async () => {
                 const sleep = (ms) => new Promise(r => setTimeout(r, ms))
                 const stored = JSON.parse(localStorage.getItem('bmp:history') || '[]')
                 // 移动端侧栏是抽屉：先打开
                 let entry = document.querySelector('.sidebar .history-item')
                 if (!entry || entry.offsetParent === null) {
                   document.querySelector('.topbar .menu-btn')?.click()
                   await sleep(500)
                   entry = document.querySelector('.sidebar .history-item')
                 }
                 entry?.click()
                 await sleep(500)
                 const rows = () => [...document.querySelectorAll('.history-row')]
                 const onHistoryPage = location.hash === '#/history'
                 const rowCount = rows().length
                 const first = rows()[0]?.querySelector('.t-name')?.textContent?.trim() || ''
                 const timeText = rows()[0]?.querySelector('.h-time')?.textContent?.trim() || ''
                 // 播放第一行（本地队列，不改主列表）
                 rows()[0]?.querySelector('.play-mini')?.click()
                 await sleep(1500)
                 const active = !!document.querySelector('.history-row.active')
                 const npTitle = document.querySelector('.np-title')?.textContent?.trim() || ''
                  // 清空：通用二次确认弹窗（P4.0）→ 点「清空」→ 弹窗出现 → 点确认
                  const clearBtn = [...document.querySelectorAll('.history-view .header-actions .btn')].find(b => /清空/.test(b.textContent))
                  clearBtn?.click()
                  let dialogText = ''
                  for (let i = 0; i < 20; i++) {
                    await sleep(100)
                    dialogText = document.querySelector('.confirm-dialog .confirm-message')?.textContent?.trim() || ''
                    if (dialogText) break
                  }
                  const confirmBtn = [...document.querySelectorAll('.confirm-dialog .dialog-foot .btn')].find(b => /清空/.test(b.textContent))
                  confirmBtn?.click()
                  for (let i = 0; i < 20; i++) {
                    await sleep(150)
                    if (document.querySelector('.history-view .center-msg')) break
                  }
                  const dialogClosed = !document.querySelector('.confirm-dialog')
                  const emptyAfter = !!document.querySelector('.history-view .center-msg')
                 return { storedCount: stored.length, storedFirst: stored[0]?.song?.name || '', onHistoryPage, rowCount, first, timeText, active, npTitle, dialogText, dialogClosed, emptyAfter }
               })()`,
              { awaitPromise: true }
            )
            log('播放过的歌进入本地历史', h.storedCount >= 1 && h.storedFirst.length > 0, JSON.stringify({ count: h.storedCount, first: h.storedFirst }))
            log('侧栏进入最近播放页', h.onHistoryPage === true && h.rowCount === h.storedCount, JSON.stringify(h))
            log('历史行显示歌名与播放时间', h.first.length > 0 && h.timeText.length > 0, `${h.first} / ${h.timeText}`)
            log('从历史页播放（本地队列）', h.active === true && h.npTitle === h.first, JSON.stringify({ active: h.active, npTitle: h.npTitle }))
            log('清空需二次确认（通用弹窗）', h.dialogText.length > 0 && h.dialogClosed === true, h.dialogText)
            log('清空后历史页为空', h.emptyAfter === true, JSON.stringify(h))
          }

          // 睡眠定时（P1.3）：打开菜单 → 选 15 分钟 → 角标倒计时 → 关闭
          {
            const s = await evaluate(
              `(async () => {
                 const sleep = (ms) => new Promise(r => setTimeout(r, ms))
                 let btn = document.querySelector('.player .sleep-btn')
                 let openedFromFull = false
                 if (!btn || btn.offsetParent === null) {
                   document.querySelector('.player .now-playing')?.click()
                   await sleep(500)
                   btn = document.querySelector('.np-top .sleep-btn')
                   openedFromFull = true
                 }
                 if (!btn) return { found: false }
                 btn.click()
                 await sleep(300)
                 const menuOpen = !!document.querySelector('.sleep-menu')
                 const opts = [...document.querySelectorAll('.sleep-menu .sleep-opt')].map(b => b.textContent.trim())
                 const opt15 = [...document.querySelectorAll('.sleep-menu .sleep-opt')].find(b => /15 分钟/.test(b.textContent))
                 opt15?.click()
                 await sleep(1200)
                 const badge = document.querySelector('.sleep-btn .sleep-badge')?.textContent?.trim() || ''
                 const onClass = document.querySelector('.sleep-btn')?.className || ''
                 // 重新打开菜单并关闭定时
                 document.querySelector('.sleep-btn')?.click()
                 await sleep(300)
                 const menuTitle = document.querySelector('.sleep-menu-title')?.textContent?.trim() || ''
                 const cancelBtn = [...document.querySelectorAll('.sleep-menu .sleep-opt')].find(b => /关闭定时/.test(b.textContent))
                 cancelBtn?.click()
                 await sleep(400)
                 const badgeAfter = document.querySelector('.sleep-btn .sleep-badge')?.textContent?.trim() || ''
                 if (openedFromFull) { document.querySelector('.np-top .icon-btn')?.click(); await sleep(300) }
                 return { found: true, menuOpen, opts, badge, onClass, menuTitle, badgeAfter }
               })()`,
              { awaitPromise: true }
            )
            log('睡眠定时菜单可打开', s.found && s.menuOpen && s.opts.length === 5, JSON.stringify(s.opts))
            log('选择 15 分钟后按钮显示倒计时', /^\d+m$/.test(s.badge) && /on/.test(s.onClass), `${s.badge} | ${s.onClass}`)
            log('定时中菜单显示剩余时间', /剩余/.test(s.menuTitle), s.menuTitle)
            log('可关闭睡眠定时', s.badgeAfter === '', JSON.stringify({ badgeAfter: s.badgeAfter }))
          }

          // 媒体控制（P1.4 Web）：系统媒体面板元数据
          {
            const m = await evaluate(
              `(() => {
                 const has = typeof navigator !== 'undefined' && !!navigator.mediaSession
                 const meta = has && navigator.mediaSession.metadata
                   ? {
                       title: navigator.mediaSession.metadata.title || '',
                       artist: navigator.mediaSession.metadata.artist || '',
                       artwork: (navigator.mediaSession.metadata.artwork || []).length,
                     }
                   : null
                 return { has, meta, state: has ? navigator.mediaSession.playbackState || '' : '' }
               })()`
            )
            if (!m.has) {
              console.log('SKIP  媒体控制元数据（当前浏览器无 mediaSession）')
            } else {
              const npTitle = await evaluate("document.querySelector('.np-title')?.textContent?.trim() || ''")
              log('媒体控制：元数据标题与当前曲一致', !!m.meta && m.meta.title === npTitle && m.meta.artist.length > 0, JSON.stringify(m.meta))
              log('媒体控制：播放状态已上报', /playing|paused/.test(m.state), m.state)
            }
          }

          // 全屏歌词（P2.2）：封面 ↔ 歌词、当前行高亮、点击定位、切回封面
          {
            const ly = await evaluate(
              `(async () => {
                 const sleep = (ms) => new Promise(r => setTimeout(r, ms))
                 if (!document.querySelector('.now-playing-full')) {
                   document.querySelector('.player .now-playing')?.click()
                   await sleep(600)
                 }
                 if (!document.querySelector('.np-lyric-wrap')) {
                   document.querySelector('.np-cover-wrap')?.click()
                   await sleep(500)
                 }
                 // 等歌词渲染（当前曲可能不是 demo1，歌词走网络/缓存都需要时间；点第三行需要 ≥3 行）
                 for (let i = 0; i < 40; i++) {
                   await sleep(200)
                   if (document.querySelectorAll('.np-lyric-line').length >= 3) break
                 }
                 const wrap = !!document.querySelector('.np-lyric-wrap')
                 const lines = document.querySelectorAll('.np-lyric-line').length
                 const activeIdx = [...document.querySelectorAll('.np-lyric-line')].findIndex(e => e.classList.contains('active'))
                 const firstText = document.querySelector('.np-lyric-line .l-text')?.textContent?.trim() || ''
                 const firstTrans = document.querySelector('.np-lyric-line .l-trans')?.textContent?.trim() || ''
                 // 等播放真正开始推进：演示模式里 B 站匹配完成会换源并重置到 0:00，
                 // 此刻点歌词行会被 seek 的 total 保护吞掉（no-op）——等不到则跳过该断言
                 let seekable = false
                 for (let i = 0; i < 24; i++) {
                   const t0 = document.querySelectorAll('.np-times span')[0]?.textContent?.trim() || ''
                   const staticBar = !!document.querySelector('.np-bar')?.classList.contains('static')
                   if (!staticBar && t0 && t0 !== '0:00' && /^\d+:\d\d$/.test(t0)) {
                     seekable = true
                     break
                   }
                   await sleep(250)
                 }
                 // 点第三行（60s）定位；换源后需要时间落到 t=60，轮询等待
                 const target = [...document.querySelectorAll('.np-lyric-line')][2]
                 if (seekable) target?.click()
                 let times = []
                 for (let i = 0; i < 25; i++) {
                   await sleep(150)
                   times = [...document.querySelectorAll('.np-times span')].map(e => e.textContent.trim())
                   if (/^1:0\d$/.test(times[0] || '')) break
                 }
                 const activeIdx2 = [...document.querySelectorAll('.np-lyric-line')].findIndex(e => e.classList.contains('active'))
                 // 按钮切回封面
                 const btn = [...document.querySelectorAll('.np-top .icon-btn')].find(b => /歌词|封面/.test(b.title || ''))
                 btn?.click()
                 await sleep(400)
                 const backToCover = !!document.querySelector('.np-cover-wrap') && !document.querySelector('.np-lyric-wrap')
                 document.querySelector('.np-top .icon-btn')?.click()
                 await sleep(300)
                 return { wrap, lines, activeIdx, firstText, firstTrans, times, activeIdx2, backToCover, seekable, collapsed: !document.querySelector('.now-playing-full') }
               })()`,
              { awaitPromise: true }
            )
            log('全屏播放器可切到歌词（4 行）', ly.wrap === true && ly.lines === 4, JSON.stringify(ly))
            log(
              '歌词当前行高亮 + 翻译显示',
              ly.activeIdx >= 0 && ly.firstText === '第一句歌词' && ly.firstTrans === 'First line',
              JSON.stringify({ activeIdx: ly.activeIdx, firstText: ly.firstText, firstTrans: ly.firstTrans })
            )
            if (!ly.seekable) {
              console.log('SKIP  点击歌词行定位（当前音源不可拖动，B 站匹配未完成时点击为 no-op）')
            } else {
              log('点击歌词行定位（约 1:00 且第三行高亮）', /^1:0\d$/.test(ly.times[0] || '') && ly.activeIdx2 === 2, JSON.stringify(ly.times))
            }
            log('可切回封面并收起', ly.backToCover === true && ly.collapsed === true, JSON.stringify({ backToCover: ly.backToCover, collapsed: ly.collapsed }))
          }

          // Web 隐藏原生专属入口（通知栏控制 / 桌面歌词）
          {
            const nativeEntries = await evaluate(
              `(() => {
                 const full = !!document.querySelector('.now-playing-full')
                 const desktopBtn = !!document.querySelector('.desktop-lyric-btn')
                 return { full, desktopBtn }
               })()`
            )
            log('Web 隐藏桌面歌词入口', nativeEntries.desktopBtn === false, JSON.stringify(nativeEntries))
          }


          // 歌词校准（S1）：延后/提前/重置 + 持久化
          {
            const cal = await evaluate(
              `(async () => {
                 const sleep = (ms) => new Promise(r => setTimeout(r, ms))
                 if (!document.querySelector('.now-playing-full')) {
                   document.querySelector('.player .now-playing')?.click()
                   await sleep(600)
                 }
                 if (!document.querySelector('.np-lyric-wrap')) {
                   document.querySelector('.np-cover-wrap')?.click()
                   await sleep(400)
                 }
                 const bar = !!document.querySelector('.lyric-calib')
                 const plus = document.querySelector('.lyric-calib .calib-btn[data-delta="0.5"]')
                 const minus = document.querySelector('.lyric-calib .calib-btn[data-delta="-0.5"]')
                 // 校准按钮改为 pointerdown 触发（支持长按连续），测试用指针事件
                 const tap = (el) => {
                   if (!el) return
                   el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }))
                   el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
                 }
                 tap(plus); tap(plus)
                 await sleep(400)
                 const valueAfterPlus = document.querySelector('.calib-value')?.textContent?.trim() || ''
                 const storedAfterPlus = localStorage.getItem('bmp:lyric-offset') || ''
                 tap(minus); tap(minus); tap(minus); tap(minus)
                 await sleep(400)
                 const valueAfterMinus = document.querySelector('.calib-value')?.textContent?.trim() || ''
                 const resetDisabled = !!document.querySelector('.calib-reset')?.disabled
                 document.querySelector('.calib-reset')?.click()
                 await sleep(400)
                 const valueAfterReset = document.querySelector('.calib-value')?.textContent?.trim() || ''
                 const storedAfterReset = localStorage.getItem('bmp:lyric-offset') || ''
                 const resetDisabledAfter = !!document.querySelector('.calib-reset')?.disabled
                 // 长按连续调整：按住 1.2s 应走多步（≥2s）
                 plus?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }))
                 await sleep(1200)
                 plus?.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
                 await sleep(400)
                 const valueAfterHold = document.querySelector('.calib-value')?.textContent?.trim() || ''
                 const heldSteps = Number((valueAfterHold.match(/\\d+(?:\\.\\d+)?/) || ['0'])[0])
                 document.querySelector('.calib-reset')?.click()
                 await sleep(400)
                 // 校准条不应换行/溢出（360px 宽）
                 const barEl = document.querySelector('.lyric-calib')
                 const noWrap = barEl ? barEl.scrollWidth <= barEl.clientWidth + 1 : false
                 const btnHeights = [...document.querySelectorAll('.lyric-calib .calib-btn')].map((b) => Math.round(b.getBoundingClientRect().height))
                 const singleLine = btnHeights.every((h) => h > 0 && h < 40)
                 const resetTitle = document.querySelector('.calib-reset')?.title || ''
                 const desktopBtnTitle = document.querySelector('.desktop-lyric-btn')?.title || ''
                 document.querySelector('.np-top .icon-btn')?.click()
                 await sleep(300)
                 return { bar, valueAfterPlus, storedAfterPlus, valueAfterMinus, resetDisabled, valueAfterReset, storedAfterReset, resetDisabledAfter, valueAfterHold, heldSteps, noWrap, singleLine, btnHeights, resetTitle, desktopBtnTitle }
               })()`,
              { awaitPromise: true }
            )
            log('歌词页有校准工具条', cal.bar === true, JSON.stringify(cal))
            log(
              '「延后」+1.0s 并持久化',
              /\+1\.0s 延后/.test(cal.valueAfterPlus) && /"demo1":1000/.test(cal.storedAfterPlus),
              JSON.stringify({ v: cal.valueAfterPlus, s: cal.storedAfterPlus })
            )
            log(
              '「提前」-1.0s 生效（重置按钮可用）',
              /-1\.0s 提前/.test(cal.valueAfterMinus) && cal.resetDisabled === false,
              JSON.stringify({ v: cal.valueAfterMinus, d: cal.resetDisabled })
            )
            log(
              '重置恢复未校准并清掉持久化',
              cal.valueAfterReset === '未校准' && !/"demo1"/.test(cal.storedAfterReset) && cal.resetDisabledAfter === true,
              JSON.stringify({ v: cal.valueAfterReset, s: cal.storedAfterReset })
            )
            log('长按「延后」连续调整（≥2s）', cal.heldSteps >= 2, `hold=${cal.valueAfterHold} steps=${cal.heldSteps}`)
            log('校准条不换行、按钮单行', cal.noWrap === true && cal.singleLine === true, JSON.stringify({ noWrap: cal.noWrap, heights: cal.btnHeights }))
            log('重置为图标按钮且有 title', cal.resetTitle.length > 0, cal.resetTitle)
          }

          // 进度条 seek 稳定性：点按后停在目标位置（不回弹）
          {
            const sk = await evaluate(
              `(async () => {
                 const sleep = (ms) => new Promise(r => setTimeout(r, ms))
                 if (!document.querySelector('.now-playing-full')) {
                   document.querySelector('.player .now-playing')?.click()
                   await sleep(600)
                 }
                 const bar = document.querySelector('.np-bar')
                 if (!bar) return { found: false }
                 if (bar.classList.contains('static')) return { found: true, static: true }
                 const rect = bar.getBoundingClientRect()
                 const ratioOf = () => parseFloat(document.querySelector('.np-bar .fill')?.style?.width || '0') || 0
                 const before = ratioOf()
                 const targetFrac = Math.min(0.9, Math.max(0.2, before / 100 + 0.35))
                 const x = rect.left + rect.width * targetFrac
                 const y = rect.top + rect.height / 2
                 const ev = (type) => new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 7 })
                 bar.dispatchEvent(ev('pointerdown'))
                 await sleep(100)
                 const during = ratioOf()
                 bar.dispatchEvent(ev('pointerup'))
                 const samples = []
                 for (let i = 0; i < 6; i++) {
                   await sleep(200)
                   samples.push(ratioOf())
                 }
                 const min = Math.min(...samples)
                 const expected = Math.round(targetFrac * 1000) / 10
                 document.querySelector('.np-top .icon-btn')?.click()
                 await sleep(300)
                 return { found: true, static: false, before, during, expected, samples, min }
               })()`,
              { awaitPromise: true }
            )
            if (!sk.found) {
              console.log('SKIP  进度条 seek 稳定性（未找到进度条）')
            } else if (sk.static) {
              console.log('SKIP  进度条 seek 稳定性（当前音源不可拖动）')
            } else {
              const far = Math.abs(sk.expected - sk.before) > 10
              log('点按进度条立即预览到目标位置', Math.abs(sk.during - sk.expected) < 3, JSON.stringify({ during: sk.during, expected: sk.expected }))
              log('点按后不回弹（停在目标附近）', far ? Math.abs(sk.min - sk.expected) < 8 : true, JSON.stringify(sk))
            }
          }

          // 搜索（P3.1）：CDP Fetch 拦截 QQ 搜索 CGI → fixture，离线验证搜索全流程
          if (DEMO) {
            await enableFetchMock()
            mockQqSearch()
            mockQqHotSuggest()
            const pausedBefore = fetchMockPaused
            const s = await evaluate(
              `(async () => {
                 const sleep = (ms) => new Promise(r => setTimeout(r, ms))
                 let entry = [...document.querySelectorAll('.sidebar .nav-item')].find(el => /^搜索/.test(el.textContent.trim()))
                 if (!entry || entry.offsetParent === null) {
                   document.querySelector('.topbar .menu-btn')?.click()
                   await sleep(400)
                   entry = [...document.querySelectorAll('.sidebar .nav-item')].find(el => /^搜索/.test(el.textContent.trim()))
                 }
                 entry?.click()
                 await sleep(900)
                 const onSearch = location.hash === '#/search'
                 // 热搜榜（fixture）：进入搜索页即渲染，点第一条触发搜索
                 for (let i = 0; i < 40; i++) {
                   await sleep(150)
                   if (document.querySelectorAll('.sv-hot .sv-chip').length) break
                 }
                 const hotCount = document.querySelectorAll('.sv-hot .sv-chip').length
                 const hotFirst = document.querySelector('.sv-hot .sv-chip')?.textContent?.replace(/\\s+/g, ' ').trim() || ''
                 // ④ 热搜「换一换」：窗口轮换（fixture 15 条、窗口 12 条）
                 document.querySelector('.sv-hot .sv-history-head .btn')?.click()
                 await sleep(300)
                 const hotFirstAfter = document.querySelector('.sv-hot .sv-chip')?.textContent?.replace(/\\s+/g, ' ').trim() || ''
                 const hotRotated = !!hotFirstAfter && hotFirstAfter !== hotFirst
                 document.querySelector('.sv-hot .sv-chip')?.click()
                 await sleep(900)
                 const hotRows = document.querySelectorAll('.sv-row').length
                 const input = document.querySelector('.sv-input')
                 let inputValue = ''
                 if (input) {
                   input.value = '晴天'
                   input.dispatchEvent(new Event('input', { bubbles: true }))
                   inputValue = input.value
                 }
                 await sleep(150)
                 const btnDisabled = !!document.querySelector('.sv-go')?.disabled
                 document.querySelector('.sv-go')?.click()
                 await sleep(500)
                 const errorAfter = document.querySelector('.sv-error')?.textContent?.trim() || ''
                 for (let i = 0; i < 40; i++) {
                   await sleep(200)
                   if (document.querySelectorAll('.sv-row').length) break
                 }
                 // 输入联想（fixture）：输入「稻香」→ 等下拉 → 点第一条（单曲：晴天）
                 if (input) {
                   input.value = '稻香'
                   input.dispatchEvent(new Event('input', { bubbles: true }))
                 }
                 for (let i = 0; i < 30; i++) {
                   await sleep(150)
                   if (document.querySelector('.sv-sug-item')) break
                 }
                 const sugCount = document.querySelectorAll('.sv-sug-item').length
                 const sugFirst = document.querySelector('.sv-sug-item .sug-name')?.textContent?.trim() || ''
                 const sugType = document.querySelector('.sv-sug-item .sug-type')?.textContent?.trim() || ''
                 document.querySelector('.sv-sug-item')?.click()
                 await sleep(1000)
                 const sugRows = document.querySelectorAll('.sv-row').length
                 const sugClosed = !document.querySelector('.sv-sug')
                 const rows = document.querySelectorAll('.sv-row').length
                  const firstName = document.querySelector('.sv-row .s-name')?.textContent?.trim() || ''
                  const vipCount = document.querySelectorAll('.sv-row .s-name[data-vip]').length
                 const total = document.querySelector('.sv-total')?.textContent?.trim() || ''
                 const moreBtn = !!document.querySelector('.sv-more .btn')
                 document.querySelector('.sv-more .btn')?.click()
                 await sleep(900)
                 const rowsAfterMore = document.querySelectorAll('.sv-row').length
                 const moreGone = !document.querySelector('.sv-more .btn')
                 const albumTab = [...document.querySelectorAll('.sv-tab')].find(b => /专辑/.test(b.textContent))
                 albumTab?.click()
                 await sleep(900)
                 const albumName = document.querySelector('.sv-row .s-name')?.textContent?.trim() || ''
                 const songTab = [...document.querySelectorAll('.sv-tab')].find(b => /单曲/.test(b.textContent))
                 songTab?.click()
                 await sleep(700)
                 document.querySelector('.sv-row .s-actions .icon-btn')?.click()
                 await sleep(900)
                 const npTitle = document.querySelector('.np-title')?.textContent?.trim() || ''
                 // ④ 历史单条删除：回首页再进搜索页（未搜索态显示历史）
                 const historyBefore = JSON.parse(localStorage.getItem('bmp:search-history') || '[]')
                 location.hash = '#/'
                 await sleep(400)
                 location.hash = '#/search'
                 await sleep(700)
                 const firstChip = document.querySelector('.sv-history .sv-chip-text')?.textContent?.trim() || ''
                 document.querySelector('.sv-history .sv-chip-del .sv-chip-x')?.click()
                 await sleep(300)
                 const historyAfter = JSON.parse(localStorage.getItem('bmp:search-history') || '[]')
                  return {
                    onSearch, rows, firstName, total, moreBtn, rowsAfterMore, moreGone, albumName, npTitle, vipCount,
                   hotCount, hotFirst, hotRows, sugCount, sugFirst, sugType, sugRows, sugClosed,
                   hotFirstAfter, hotRotated, historyBefore, historyAfter, firstChip,
                   error: document.querySelector('.sv-error')?.textContent?.trim() || '',
                   inputValue, btnDisabled, errorAfter,
                   history: historyBefore,
                 }
               })()`,
              { awaitPromise: true }
            )
            log('侧栏进入搜索页', s.onSearch === true, JSON.stringify({ hash: s.onSearch }))
            log(
              '热搜榜渲染（fixture，点第一条可搜）',
              s.hotCount === 12 && s.hotFirst.includes('易烊千玺dvd') && s.hotRows > 0,
              JSON.stringify({ hotCount: s.hotCount, hotFirst: s.hotFirst, hotRows: s.hotRows })
            )
            log('热搜「换一换」轮换窗口（无新请求）', s.hotRotated === true, JSON.stringify({ before: s.hotFirst, after: s.hotFirstAfter }))
            log(
              '输入联想下拉（fixture）并点击搜索',
              s.sugCount === 8 && s.sugFirst === '晴天' && s.sugType === '单曲' && s.sugRows > 0 && s.sugClosed === true,
              JSON.stringify({ sugCount: s.sugCount, sugFirst: s.sugFirst, sugType: s.sugType, sugRows: s.sugRows, sugClosed: s.sugClosed })
            )
            log('单曲结果渲染（fixture）', s.rows === 2 && s.firstName === '晴天', JSON.stringify({ rows: s.rows, first: s.firstName, error: s.error, inputValue: s.inputValue, btnDisabled: s.btnDisabled, errorAfter: s.errorAfter, pausedBefore, pausedAfter: fetchMockPaused }))
            log('VIP 歌曲标注（fixture 晴天 payplay=1，data-vip 不污染歌名）', s.vipCount === 2 && s.firstName === '晴天', JSON.stringify({ vipCount: s.vipCount, firstName: s.firstName }))
            log('分类总数显示', s.total === '600', s.total)
            log(
              '「加载更多」追加第 2 页（总数 600，按钮保留）',
              s.moreBtn === true && s.rowsAfterMore === 3 && s.moreGone === false,
              JSON.stringify({ rowsAfterMore: s.rowsAfterMore, moreGone: s.moreGone })
            )
            log('专辑 Tab 可切换', s.albumName === '叶惠美', s.albumName)
            log('搜索结果可播放（进入播放器）', s.npTitle === '晴天', s.npTitle)
            log('搜索历史已记录', s.history[0] === '晴天', JSON.stringify(s.history))
            log(
              '搜索历史单条删除（× 按钮）',
              s.historyBefore.length >= 1 &&
                s.historyAfter.length === s.historyBefore.length - 1 &&
                s.firstChip === s.historyBefore[0] &&
                !s.historyAfter.includes(s.firstChip),
              JSON.stringify({ before: s.historyBefore.slice(0, 3), after: s.historyAfter.slice(0, 3), firstChip: s.firstChip })
            )
            await disableFetchMock()
          }

          // 排行榜（P3.3）：CDP Fetch 拦截 musicu 榜单接口 → fixture，离线验证浏览与播放
          if (DEMO) {
            await enableFetchMock()
            mockQqRank()
            const r = await evaluate(
              `(async () => {
                 const sleep = (ms) => new Promise(r => setTimeout(r, ms))
                 const rankEntry = () => [...document.querySelectorAll('.sidebar .nav-item')].find(el => /排行榜/.test(el.textContent))
                 let entry = rankEntry()
                 if (!entry || entry.offsetParent === null) {
                   document.querySelector('.topbar .menu-btn')?.click()
                   await sleep(400)
                   entry = rankEntry()
                 }
                 entry?.click()
                 for (let i = 0; i < 60; i++) {
                   await sleep(200)
                   if (document.querySelector('.rk-head')) break
                 }
                 const onRank = location.hash === '#/rank'
                 const cards = document.querySelectorAll('.rk-card').length
                 const activeCard = document.querySelector('.rk-card.on .rk-card-name')?.textContent?.trim() || ''
                 const title = document.querySelector('.rk-title')?.textContent?.trim() || ''
                 const rows = document.querySelectorAll('.rk-row').length
                 const rank1 = document.querySelector('.rk-rank')?.textContent?.trim() || ''
                 const firstName = document.querySelector('.rk-row .s-name')?.textContent?.trim() || ''
                 const cardEls = [...document.querySelectorAll('.rk-card')]
                 const targetCard = cardEls.find(el => /飙升榜/.test(el.textContent))
                 targetCard?.click()
                 await sleep(900)
                 const title2 = document.querySelector('.rk-title')?.textContent?.trim() || ''
                 const delta = document.querySelector('.rk-row .rk-delta')?.textContent?.trim() || ''
                 const deltas = [...document.querySelectorAll('.rk-delta')].map(e => e.textContent.trim())
                 const rows2 = document.querySelectorAll('.rk-row').length
                 const moreBtn = document.querySelector('.rk-row .s-actions [title="更多操作"]')
                 const keyBtns = document.querySelectorAll('.rk-row .s-actions .rk-key').length
                 const extraBtns = document.querySelectorAll('.rk-row .s-actions .rk-extra').length
                 const extraVisible = [...document.querySelectorAll('.rk-row .s-actions .rk-extra')].some((b) => getComputedStyle(b).display !== 'none')
                 const keyVisible = [...document.querySelectorAll('.rk-row .s-actions .rk-key')].some((b) => getComputedStyle(b).display !== 'none')
                 const playBtn = [...document.querySelectorAll('.rk-head .btn')].find(b => /播放全部/.test(b.textContent))
                 playBtn?.click()
                 await sleep(1200)
                 const npTitle = document.querySelector('.np-title')?.textContent?.trim() || ''
                 return { onRank, cards, activeCard, title, rows, rank1, firstName, title2, delta, deltas, rows2, npTitle, moreBtn: !!moreBtn, keyBtns, extraBtns, extraVisible, keyVisible, error: document.querySelector('.rk-view .sv-error')?.textContent?.trim() || '' }
               })()`,
              { awaitPromise: true }
            )
            log('侧栏进入排行榜并渲染卡片', r.onRank === true && r.cards === 2 && r.activeCard === '热歌榜', JSON.stringify({ onRank: r.onRank, cards: r.cards, activeCard: r.activeCard, error: r.error }))
            log(
              '默认打开热歌榜（fixture，排名 1 = 茶汤）',
              r.title === '热歌榜' && r.rows === 3 && r.rank1 === '1' && r.firstName.startsWith('茶汤'),
              JSON.stringify({ title: r.title, rows: r.rows, rank1: r.rank1, firstName: r.firstName })
            )
            log(
              'rk 行内操作随断点切换（桌面播放/下一首，移动端喜欢/下载/更多）',
              r.moreBtn === true &&
                r.extraBtns >= r.rows2 &&
                r.keyBtns === r.rows2 * 2 &&
                r.extraVisible === MOBILE &&
                r.keyVisible === !MOBILE,
              JSON.stringify({ moreBtn: r.moreBtn, keyBtns: r.keyBtns, extraBtns: r.extraBtns, extraVisible: r.extraVisible, keyVisible: r.keyVisible, mobile: MOBILE })
            )
            log('切换榜单（飙升榜 + 涨幅角标）', r.title2 === '飙升榜' && r.delta === '15%', JSON.stringify({ title2: r.title2, delta: r.delta, deltas: r.deltas, rows2: r.rows2 }))
            log('播放全部（进入播放器）', r.npTitle.startsWith('茶汤'), r.npTitle)
            await disableFetchMock()
          }

          // 歌单广场（P3.4）：CDP Fetch 拦截分类/列表/歌单详情 → fixture，离线验证浏览与打开
          if (DEMO) {
            await enableFetchMock()
            mockQqSquare()
            const sq = await evaluate(
              `(async () => {
                 const sleep = (ms) => new Promise(r => setTimeout(r, ms))
                 const squareEntry = () => [...document.querySelectorAll('.sidebar .nav-item')].find(el => /歌单广场/.test(el.textContent))
                 let entry = squareEntry()
                 if (!entry || entry.offsetParent === null) {
                   document.querySelector('.topbar .menu-btn')?.click()
                   await sleep(400)
                   entry = squareEntry()
                 }
                 entry?.click()
                 for (let i = 0; i < 60; i++) {
                   await sleep(200)
                   if (document.querySelector('.sq-card')) break
                 }
                 const onSquare = location.hash === '#/square'
                 const groupNames = [...document.querySelectorAll('.sq-group')].map(e => e.textContent.trim())
                 const activeGroup = document.querySelector('.sq-group.on')?.textContent?.trim() || ''
                 const activeTag = document.querySelector('.sq-tag.on')?.textContent?.trim() || ''
                 const cards = document.querySelectorAll('.sq-card').length
                 const first = document.querySelector('.sq-card .sq-name')?.textContent?.trim() || ''
                 const meta = document.querySelector('.sq-card .sq-meta')?.textContent?.replace(/\\s+/g, ' ').trim() || ''
                 // 切分组到「流派」→ 点「摇滚」（非「全部」分类时 mock 改写首个歌单名）
                 const flowGroup = [...document.querySelectorAll('.sq-group')].find(b => b.textContent.trim() === '流派')
                 flowGroup?.click()
                 await sleep(900)
                 const firstAfterGroup = document.querySelector('.sq-card .sq-name')?.textContent?.trim() || ''
                 const rock = [...document.querySelectorAll('.sq-tag')].find(b => b.textContent.trim() === '摇滚')
                 rock?.click()
                 await sleep(900)
                 const firstAfterTag = document.querySelector('.sq-card .sq-name')?.textContent?.trim() || ''
                 const moreBtn = [...document.querySelectorAll('.sq-view .sv-more .btn')].find(b => /加载更多/.test(b.textContent))
                 moreBtn?.click()
                 await sleep(900)
                 const cardsAfterMore = document.querySelectorAll('.sq-card').length
                 document.querySelector('.sq-card')?.click()
                 let plName = ''
                 for (let i = 0; i < 60; i++) {
                   await sleep(250)
                   plName = document.querySelector('.playlist-header h1')?.textContent?.trim() || ''
                   if (plName) break
                 }
                 const sub = document.querySelector('.playlist-header .sub')?.textContent?.replace(/\\s+/g, ' ').trim() || ''
                 return { onSquare, groupNames, activeGroup, activeTag, cards, first, meta, firstAfterGroup, firstAfterTag, cardsAfterMore, hashAfter: location.hash, plName, sub, error: document.querySelector('.sq-view .sv-error')?.textContent?.trim() || '' }
               })()`,
              { awaitPromise: true }
            )
            log(
              '侧栏进入歌单广场（分组 + 分类 + 卡片）',
              sq.onSquare === true && sq.groupNames.includes('热门') && sq.groupNames.includes('流派') && sq.activeGroup === '热门' && sq.activeTag === '全部' && sq.cards === 10 && sq.first.startsWith('甜度爆表') && sq.meta.length > 0,
              JSON.stringify({ onSquare: sq.onSquare, groupNames: sq.groupNames, activeGroup: sq.activeGroup, activeTag: sq.activeTag, cards: sq.cards, first: sq.first, error: sq.error })
            )
            log(
              '切换分组与分类（流派 → 摇滚，首个歌单变化）',
              sq.firstAfterGroup === '摇滚精选｜现场热歌' && sq.firstAfterTag === '摇滚精选｜现场热歌',
              JSON.stringify({ firstAfterGroup: sq.firstAfterGroup, firstAfterTag: sq.firstAfterTag })
            )
            log('「加载更多」追加第二页', sq.cardsAfterMore === 20, String(sq.cardsAfterMore))
            log(
              '点歌单卡片 → 打开歌单并跳转',
              sq.plName.startsWith('甜度爆表') && sq.sub.includes('3 首歌曲') && sq.hashAfter === '#/',
              JSON.stringify({ plName: sq.plName, sub: sq.sub, hashAfter: sq.hashAfter })
            )
            await disableFetchMock()
          }

          // 每日推荐（P3.5）：CDP Fetch 拦截 GetRadarSong → fixture，离线验证渲染与播放
          if (DEMO) {
            await enableFetchMock()
            mockQqDaily()
            const pausedBeforeDaily = fetchMockPaused
            const dy = await evaluate(
              `(async () => {
                 const sleep = (ms) => new Promise(r => setTimeout(r, ms))
                 // 若已在日推页（例如前一个用例误入），先离开以便重新挂载
                 if (location.hash === '#/daily') {
                   location.hash = '#/'
                   await sleep(600)
                 }
                 const entryOf = () => [...document.querySelectorAll('.sidebar .nav-item')].find(el => /每日推荐/.test(el.textContent))
                 let entry = entryOf()
                 if (!entry || entry.offsetParent === null) {
                   document.querySelector('.topbar .menu-btn')?.click()
                   await sleep(400)
                   entry = entryOf()
                 }
                 entry?.click()
                 for (let i = 0; i < 60; i++) {
                   await sleep(200)
                   if (document.querySelector('.dy-head') && document.querySelectorAll('.daily-view .rk-row').length) break
                 }
                 const onDaily = location.hash === '#/daily'
                 const title = document.querySelector('.dy-title')?.textContent?.trim() || ''
                 const rows = document.querySelectorAll('.daily-view .rk-row').length
                 const names = [...document.querySelectorAll('.daily-view .rk-row .s-name')].slice(0, 3).map(e => e.textContent.trim())
                 const sub = document.querySelector('.dy-sub')?.textContent?.replace(/\\s+/g, ' ').trim() || ''
                 const playAll = [...document.querySelectorAll('.dy-actions .btn')].find(b => /播放全部/.test(b.textContent))
                 playAll?.click()
                 await sleep(1200)
                 const npTitle = document.querySelector('.np-title')?.textContent?.trim() || ''
                 const centerText = document.querySelector('.daily-view .center-msg')?.textContent?.replace(/\s+/g, ' ').trim() || ''
                 return { onDaily, title, rows, names, sub, npTitle, centerText, error: document.querySelector('.daily-view .sv-error')?.textContent?.trim() || '' }
               })()`,
              { awaitPromise: true }
            )
            log(
              '侧栏进入每日推荐并渲染（fixture，跨页去重后 5 首）',
              dy.onDaily === true && dy.title === '每日推荐' && dy.rows === 5 && dy.names[0] === '稻香' && dy.sub.includes('根据你的收听口味生成'),
              JSON.stringify({ onDaily: dy.onDaily, title: dy.title, rows: dy.rows, names: dy.names, sub: dy.sub, centerText: dy.centerText, error: dy.error, pausedDaily: fetchMockPaused - pausedBeforeDaily, errs: consoleErrors.slice(-2) })
            )
            log('播放全部（进入播放器）', dy.npTitle.startsWith('稻香'), dy.npTitle)
            await disableFetchMock()
          }

          // 私人 FM（P3.6）：复用雷达 fixture，验证渲染 / 不喜欢换一首 / 播放
          if (DEMO) {
            await enableFetchMock()
            mockQqDaily()
            const fm = await evaluate(
              `(async () => {
                 const sleep = (ms) => new Promise(r => setTimeout(r, ms))
                 if (location.hash === '#/fm') {
                   location.hash = '#/'
                   await sleep(600)
                 }
                 const entryOf = () => [...document.querySelectorAll('.sidebar .nav-item')].find(el => /私人 FM/.test(el.textContent))
                 let entry = entryOf()
                 if (!entry || entry.offsetParent === null) {
                   document.querySelector('.topbar .menu-btn')?.click()
                   await sleep(400)
                   entry = entryOf()
                 }
                 entry?.click()
                 for (let i = 0; i < 80; i++) {
                   await sleep(200)
                   if (document.querySelectorAll('.fm-view .rk-row').length) break
                 }
                 const onFm = location.hash === '#/fm'
                 const title = document.querySelector('.fm-view .dy-title')?.textContent?.trim() || ''
                 const rowsBefore = document.querySelectorAll('.fm-view .rk-row').length
                 const firstName = document.querySelector('.fm-view .rk-row .s-name')?.textContent?.trim() || ''
                 // 不喜欢第一首 → 移除并补歌（fixture 已无可补，行数 -1）
                 document.querySelector('.fm-view .rk-row .s-actions .icon-btn[title*="不喜欢"]')?.click()
                 await sleep(1200)
                 const rowsAfter = document.querySelectorAll('.fm-view .rk-row').length
                 const firstAfter = document.querySelector('.fm-view .rk-row .s-name')?.textContent?.trim() || ''
                 const playBtn = [...document.querySelectorAll('.fm-view .dy-actions .btn')].find(b => /^\\s*播放/.test(b.textContent))
                 playBtn?.click()
                 await sleep(1200)
                 const npTitle = document.querySelector('.np-title')?.textContent?.trim() || ''
                 return { onFm, title, rowsBefore, firstName, rowsAfter, firstAfter, npTitle, error: document.querySelector('.fm-view .sv-error')?.textContent?.trim() || '' }
               })()`,
              { awaitPromise: true }
            )
            log(
              '侧栏进入私人 FM 并渲染（fixture，跨页去重 5 首）',
              fm.onFm === true && fm.title === '私人 FM' && fm.rowsBefore === 5 && fm.firstName === '稻香',
              JSON.stringify({ onFm: fm.onFm, title: fm.title, rowsBefore: fm.rowsBefore, firstName: fm.firstName, error: fm.error })
            )
            log(
              '「不喜欢」移除并换一首（行数 -1 且首行变化）',
              fm.rowsAfter === 4 && fm.firstAfter === '一个人想着一个人',
              JSON.stringify({ rowsAfter: fm.rowsAfter, firstAfter: fm.firstAfter })
            )
            log('播放（进入播放器）', fm.npTitle.startsWith('一个人想着一个人'), fm.npTitle)
            await disableFetchMock()
          }

          // 歌手页（P3.7）：mock 详情/单曲/专辑/相似歌手，验证四个 Tab
          if (DEMO) {
            await enableFetchMock()
            mockQqArtist()
            const ar = await evaluate(
              `(async () => {
                 const sleep = (ms) => new Promise(r => setTimeout(r, ms))
                 if (location.hash !== '#/artist/0025NhlN2yWrP4') location.hash = '#/artist/0025NhlN2yWrP4'
                 for (let i = 0; i < 80; i++) {
                   await sleep(200)
                   if (document.querySelector('.ar-name')) break
                 }
                 const name = document.querySelector('.ar-name')?.textContent?.replace(/\\s+/g, ' ').trim() || ''
                 const sub = document.querySelector('.ar-sub')?.textContent?.replace(/\\s+/g, ' ').trim() || ''
                 const briefLen = (document.querySelector('.ar-brief')?.textContent || '').length
                 const hotRows = document.querySelectorAll('.artist-view .rk-row').length
                 const hotFirst = document.querySelector('.artist-view .rk-row .s-name')?.textContent?.trim() || ''
                 const songsTab = [...document.querySelectorAll('.sv-tab')].find(b => /单曲/.test(b.textContent))
                 songsTab?.click()
                 await sleep(900)
                 const songRows = document.querySelectorAll('.artist-view .rk-row').length
                 const total = songsTab?.querySelector('.sv-total')?.textContent?.trim() || ''
                 const albumsTab = [...document.querySelectorAll('.sv-tab')].find(b => /专辑/.test(b.textContent))
                 albumsTab?.click()
                 await sleep(900)
                 const albumCards = document.querySelectorAll('.artist-view .sq-card').length
                 const albumFirst = document.querySelector('.artist-view .sq-card .sq-name')?.textContent?.trim() || ''
                 const simTab = [...document.querySelectorAll('.sv-tab')].find(b => /相似歌手/.test(b.textContent))
                 simTab?.click()
                 await sleep(900)
                 const simCards = document.querySelectorAll('.artist-view .ar-sim-card').length
                 const simFirst = document.querySelector('.artist-view .ar-sim-name')?.textContent?.trim() || ''
                 return { name, sub, briefLen, hotRows, hotFirst, songRows, total, albumCards, albumFirst, simCards, simFirst, error: document.querySelector('.artist-view .sv-error')?.textContent?.trim() || '' }
               })()`,
              { awaitPromise: true }
            )
            log(
              '歌手页头 + 热门（fixture）',
              ar.name.startsWith('周杰伦') && ar.sub.includes('1012 首单曲') && ar.briefLen > 50 && ar.hotRows === 3 && ar.hotFirst === '晴天',
              JSON.stringify({ name: ar.name, sub: ar.sub, briefLen: ar.briefLen, hotRows: ar.hotRows, error: ar.error })
            )
            log(
              '单曲 / 专辑 / 相似歌手 三个 Tab',
              ar.songRows === 2 && ar.total === '1012' && ar.albumCards === 2 && ar.albumFirst === '周杰伦的床边故事' && ar.simCards === 5 && ar.simFirst === 'F.I.R.飞儿乐团',
              JSON.stringify({ songRows: ar.songRows, total: ar.total, albumCards: ar.albumCards, albumFirst: ar.albumFirst, simCards: ar.simCards, simFirst: ar.simFirst })
            )
            await disableFetchMock()
          }

          // 专辑页（P3.8）：mock 旧接口歌曲 + musicu 详情增强
          if (DEMO) {
            await enableFetchMock()
            mockQqAlbum()
            const ab = await evaluate(
              `(async () => {
                 const sleep = (ms) => new Promise(r => setTimeout(r, ms))
                 if (location.hash !== '#/album/0024bjiL2aocxT') location.hash = '#/album/0024bjiL2aocxT'
                 for (let i = 0; i < 80; i++) {
                   await sleep(200)
                   if (document.querySelector('.ab-name') && document.querySelectorAll('.album-view .rk-row').length) break
                 }
                 const name = document.querySelector('.ab-name')?.textContent?.replace(/\\s+/g, ' ').trim() || ''
                 const sub = document.querySelector('.ab-sub')?.textContent?.replace(/\\s+/g, ' ').trim() || ''
                 const company = document.querySelector('.ab-company')?.textContent?.trim() || ''
                 const rows = document.querySelectorAll('.album-view .rk-row').length
                 const firstName = document.querySelector('.album-view .rk-row .s-name')?.textContent?.trim() || ''
                 const playBtn = [...document.querySelectorAll('.album-view .ab-head .btn')].find(b => /播放全部/.test(b.textContent))
                 playBtn?.click()
                 await sleep(1200)
                 const npTitle = document.querySelector('.np-title')?.textContent?.trim() || ''
                 return { name, sub, company, rows, firstName, npTitle, error: document.querySelector('.album-view .sv-error')?.textContent?.trim() || '' }
               })()`,
              { awaitPromise: true }
            )
            log(
              '专辑页头与歌曲（fixture，musicu 元信息增强）',
              ab.name.startsWith('十一月的萧邦') && ab.name.includes("November's Chopin") && ab.sub.includes('2005-11-01 发行') && ab.sub.includes('2 首歌曲') && ab.company === '杰威尔音乐有限公司' && ab.rows === 2 && ab.firstName === '夜曲',
              JSON.stringify({ name: ab.name, sub: ab.sub, company: ab.company, rows: ab.rows, firstName: ab.firstName, error: ab.error })
            )
            log('播放全部（进入播放器）', ab.npTitle.startsWith('夜曲'), ab.npTitle)
            await disableFetchMock()
          }

          // 歌曲详情页（P3.9）：从全屏播放器「歌曲详情」进入，验证相似歌曲 + 评论
          if (DEMO) {
            await enableFetchMock()
            const detailMock = mockQqSongDetail()
            const sd = await evaluate(
              `(async () => {
                 const sleep = (ms) => new Promise(r => setTimeout(r, ms))
                 if (!document.querySelector('.now-playing-full')) {
                   document.querySelector('.player .now-playing')?.click()
                   await sleep(700)
                 }
                 const detailBtn = [...document.querySelectorAll('.np-top .icon-btn')].find(b => /歌曲详情/.test(b.title || ''))
                 const hasBtn = !!detailBtn
                 detailBtn?.click()
                 for (let i = 0; i < 80; i++) {
                   await sleep(200)
                   if (document.querySelector('.sd-name') && document.querySelectorAll('.sd-sim-row').length) break
                 }
                 const onSong = location.hash.startsWith('#/song/')
                 const name = document.querySelector('.sd-name')?.textContent?.trim() || ''
                 const simRows = document.querySelectorAll('.sd-sim-row').length
                 const simFirst = document.querySelector('.sd-sim-row .s-name')?.textContent?.trim() || ''
                 const hotCount = document.querySelectorAll('.sd-comment').length
                 const hotText = document.querySelector('.sd-c-text')?.textContent?.trim() || ''
                 const countText = document.querySelector('.sd-count')?.textContent?.trim() || ''
                 const moreBtn = [...document.querySelectorAll('.song-view .sv-more .btn')].find(b => /加载更多评论/.test(b.textContent))
                 moreBtn?.click()
                 await sleep(900)
                 const commentsAfterMore = document.querySelectorAll('.sd-comment').length
                 return { hasBtn, onSong, name, simRows, simFirst, hotCount, hotText, countText, commentsAfterMore, error: document.querySelector('.song-view .sv-error')?.textContent?.trim() || '' }
               })()`,
              { awaitPromise: true }
            )
            log(
              '播放器可进入歌曲详情（入口按钮）',
              sd.hasBtn === true && sd.onSong === true && sd.name.length > 0,
              JSON.stringify({ hasBtn: sd.hasBtn, onSong: sd.onSong, name: sd.name })
            )
            log(
              '详情页：相似歌曲 + 评论（fixture）',
              sd.simRows === 2 && sd.simFirst === '开始懂了' && sd.hotCount === 4 && sd.hotText.startsWith('这是一条用于测试') && sd.countText.includes('230665'),
              JSON.stringify({ simRows: sd.simRows, simFirst: sd.simFirst, hotCount: sd.hotCount, countText: sd.countText, error: sd.error })
            )
            log('「加载更多评论」追加（4 → 6）', sd.commentsAfterMore === 6, String(sd.commentsAfterMore))

            // P5 E2：发表 / 回复 / 删除评论（写接口全 mock，不真发）
            const cw = await evaluate(
              `(async () => {
                 const sleep = (ms) => new Promise(r => setTimeout(r, ms))
                 const input = () => document.querySelector('.sd-comment-input')
                 const primary = () => document.querySelector('.sd-composer-bar .btn.primary')
                 const setVal = (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })) }
                 const waitFor = async (fn) => { for (let i = 0; i < 50; i++) { await sleep(200); if (fn()) return true } return false }
                 // ① 发表
                 setVal(input(), '测试评论 mock-123')
                 await sleep(120)
                 primary()?.click()
                 await waitFor(() => input()?.value === '' && [...document.querySelectorAll('.sd-comment')].some(n => /测试评论 mock-123/.test(n.textContent)))
                 const afterPost = {
                   toast: [...document.querySelectorAll('.toast')].map(t => t.textContent.trim()).slice(0, 2),
                   inputEmpty: input()?.value === '',
                   ownVisible: [...document.querySelectorAll('.sd-comment')].some(n => /测试评论 mock-123/.test(n.textContent) && /删除/.test(n.textContent)),
                 }
                 // ② 回复第一条评论
                 const first = document.querySelector('.sd-comment')
                 const replyBtn = [...(first?.querySelectorAll('.sd-c-act') || [])].find(b => /回复/.test(b.textContent))
                 replyBtn?.click()
                 await sleep(200)
                 const cancelBtn = [...document.querySelectorAll('.sd-composer-bar .btn')].find(b => /取消回复/.test(b.textContent))
                 setVal(input(), 'mock-reply-456')
                 await sleep(120)
                 primary()?.click()
                 await waitFor(() => ![...document.querySelectorAll('.sd-composer-bar .btn')].some(b => /取消回复/.test(b.textContent)))
                 const afterReply = {
                   hadCancel: !!cancelBtn,
                   cancelGone: ![...document.querySelectorAll('.sd-composer-bar .btn')].some(b => /取消回复/.test(b.textContent)),
                   toast: [...document.querySelectorAll('.toast')].map(t => t.textContent.trim()).slice(0, 3),
                 }
                 // ③ 删除自己刚发的评论
                 const ownRow = [...document.querySelectorAll('.sd-comment')].find(n => /测试评论 mock-123/.test(n.textContent))
                 const delBtn = ownRow ? [...ownRow.querySelectorAll('.sd-c-act')].find(b => /删除/.test(b.textContent)) : null
                 delBtn?.click()
                 await sleep(1400)
                 const afterDelete = {
                   gone: ![...document.querySelectorAll('.sd-comment')].some(n => /测试评论 mock-123/.test(n.textContent)),
                 }
                 return { afterPost, afterReply, afterDelete }
               })()`,
              { awaitPromise: true }
            )
            const postWrites = detailMock.writes.filter((w) => w.method === 'AddComment')
            log(
              '发表评论（mock 写通道 + 列表出现自己的评论）',
              cw.afterPost.inputEmpty === true && cw.afterPost.ownVisible === true && postWrites.length >= 1 && postWrites[0].param.BizType === 1,
              JSON.stringify({ ...cw.afterPost, writes: detailMock.writes.length })
            )
            log(
              '回复评论 + 删除自己的评论（mock）',
              cw.afterReply.hadCancel === true &&
                cw.afterReply.cancelGone === true &&
                postWrites.some((w) => w.param.RepliedCmId) &&
                cw.afterDelete.gone === true,
              JSON.stringify({ afterReply: cw.afterReply, afterDelete: cw.afterDelete })
            )

            // P5 E3：分享面板（复制链接 + 二维码 canvas；Web 无系统分享按钮）
            const sh = await evaluate(
              `(async () => {
                 const sleep = (ms) => new Promise(r => setTimeout(r, ms))
                 const btn = [...document.querySelectorAll('.sd-actions .btn')].find(b => /分享/.test(b.textContent))
                 btn?.click()
                 for (let i = 0; i < 20; i++) { await sleep(150); if (document.querySelector('.share-dialog')) break }
                 await sleep(400)
                 const canvas = document.querySelector('.share-dialog .share-qr')
                 return {
                   opened: !!document.querySelector('.share-dialog'),
                   canvasW: canvas?.width || 0,
                   url: document.querySelector('.share-dialog .share-url')?.textContent?.trim() || '',
                   copyBtn: !![...document.querySelectorAll('.share-dialog .btn')].find(b => /复制链接/.test(b.textContent)),
                   sysBtn: !![...document.querySelectorAll('.share-dialog .btn')].find(b => /系统分享/.test(b.textContent)),
                 }
               })()`,
              { awaitPromise: true }
            )
            log(
              '分享面板（复制链接 + 二维码，Web 隐藏系统分享）',
              sh.opened === true && sh.canvasW >= 100 && /songDetail/.test(sh.url) && sh.copyBtn === true && sh.sysBtn === false,
              JSON.stringify(sh)
            )
            await evaluate("document.querySelector('.share-dialog .dialog-head .icon-btn')?.click(); 'ok'")
            await disableFetchMock()
          }

          // 红心（P4.1）：播放器内点红心 → 变红；再点 → 取消（写接口全 mock）
          if (DEMO) {
            await enableFetchMock()
            mockQqFav()
            const fv = await evaluate(
              `(async () => {
                 const sleep = (ms) => new Promise(r => setTimeout(r, ms))
                 if (!document.querySelector('.now-playing-full')) {
                   document.querySelector('.player .now-playing')?.click()
                   await sleep(700)
                 }
                 const btn = document.querySelector('.np-foot .fav-btn')
                 const colorOf = () => {
                   const b = document.querySelector('.np-foot .fav-btn')
                   return b ? getComputedStyle(b).color : ''
                 }
                 const before = { has: !!btn, on: btn?.classList.contains('on') || false, color: colorOf(), text: btn?.textContent?.replace(/\\s+/g, ' ').trim() || '' }
                 btn?.click()
                 await sleep(1200)
                 const after = {
                   on: document.querySelector('.np-foot .fav-btn')?.classList.contains('on') || false,
                   title: document.querySelector('.np-foot .fav-btn')?.title || '',
                   color: colorOf(),
                   dialog: !!document.querySelector('.confirm-dialog'),
                 }
                 document.querySelector('.np-foot .fav-btn')?.click()
                 await sleep(1200)
                 const after2 = { on: document.querySelector('.np-foot .fav-btn')?.classList.contains('on') || false, color: colorOf() }
                 return { before, after, after2 }
               })()`,
              { awaitPromise: true }
            )
            log('播放器红心：初始未喜欢（非玫瑰红）', fv.before.has === true && fv.before.on === false && fv.before.color !== 'rgb(255, 77, 109)', JSON.stringify(fv.before))
            log(
              '点红心 → 已喜欢（类 + 计算色均为玫瑰红）',
              fv.after.on === true && /取消喜欢/.test(fv.after.title) && fv.after.color === 'rgb(255, 77, 109)' && fv.after.dialog === false,
              JSON.stringify(fv.after)
            )
            log('再点 → 取消喜欢（类移除且颜色回到非玫瑰红）', fv.after2.on === false && fv.after2.color !== 'rgb(255, 77, 109)', JSON.stringify(fv.after2))
            await disableFetchMock()
          }

          // 歌单管理（P4.4/P4.6/P4.7）：新建 → 加入歌单 → 删除（写接口全 mock）
          if (DEMO) {
            await enableFetchMock()
            mockQqPlaylistWrite()
            const pw = await evaluate(
              `(async () => {
                 const sleep = (ms) => new Promise(r => setTimeout(r, ms))
                 const wait = async (fn, tries = 60) => { for (let i = 0; i < tries; i++) { await sleep(200); const v = fn(); if (v) return v } return null }
                 // 1) 侧栏「新建歌单」→ 输入弹窗 → 创建
                 const newBtn = [...document.querySelectorAll('.sidebar .icon-btn')].find(b => /新建歌单/.test(b.title || ''))
                 const hasNewBtn = !!newBtn
                 newBtn?.click()
                 await wait(() => document.querySelector('.confirm-dialog .confirm-input'))
                 const input = document.querySelector('.confirm-dialog .confirm-input')
                 if (input) {
                   input.value = 'BMP 演示歌单'
                   input.dispatchEvent(new Event('input', { bubbles: true }))
                 }
                 const okBtn = [...document.querySelectorAll('.confirm-dialog .dialog-foot .btn')].find(b => /创建/.test(b.textContent))
                 okBtn?.click()
                 const createdRow = await wait(() => [...document.querySelectorAll('.playlist-item .pi-name')].find(e => /BMP 演示歌单/.test(e.textContent)))
                 const rowText = createdRow?.textContent?.trim() || ''
                 // 2) 打开「我喜欢的音乐」→ 头部「加入歌单」→ 选择刚建的歌单
                 document.querySelector('.sidebar .liked-item')?.click()
                 await wait(() => document.querySelectorAll('.song-row').length)
                 const addBtn = [...document.querySelectorAll('.playlist-header .btn')].find(b => /加入歌单/.test(b.textContent))
                 const hasAddBtn = !!addBtn
                 addBtn?.click()
                 await wait(() => document.querySelector('.picker-dialog'))
                 const pickerItems = [...document.querySelectorAll('.picker-item .picker-name')].map(e => e.textContent.trim())
                 const pickTarget = [...document.querySelectorAll('.picker-item')].find(b => /BMP 演示歌单/.test(b.textContent))
                 pickTarget?.click()
                 await wait(() => !document.querySelector('.picker-dialog'))
                 const pickerClosed = !document.querySelector('.picker-dialog')
                 const toastText = [...document.querySelectorAll('.toasts > *')].map(t => t.textContent.replace(/\\s+/g, ' ').trim()).join(' | ')
                 // 3) 侧栏删除该歌单（二次确认）
                 const delBtn = [...document.querySelectorAll('.playlist-item')].find(b => /BMP 演示歌单/.test(b.textContent))?.querySelector('.pl-del')
                 const hasDelBtn = !!delBtn
                 delBtn?.click()
                 await wait(() => document.querySelector('.confirm-dialog .dialog-foot .btn'))
                 const delOk = [...document.querySelectorAll('.confirm-dialog .dialog-foot .btn')].find(b => /删除/.test(b.textContent))
                 delOk?.click()
                 const gone = await wait(() => ![...document.querySelectorAll('.playlist-item .pi-name')].find(e => /BMP 演示歌单/.test(e.textContent)))
                 return { hasNewBtn, rowText, hasAddBtn, pickerItems, pickerClosed, toastText, hasDelBtn, gone: !!gone }
               })()`,
              { awaitPromise: true }
            )
            log('侧栏「新建歌单」→ 输入弹窗创建（fixture）', pw.hasNewBtn === true && pw.rowText.includes('BMP 演示歌单'), JSON.stringify({ hasNewBtn: pw.hasNewBtn, rowText: pw.rowText }))
            log(
              '头部「加入歌单」→ 选择器批量加入',
              pw.hasAddBtn === true && pw.pickerItems.includes('BMP 演示歌单') && pw.pickerClosed === true && pw.toastText.includes('已加入《BMP 演示歌单》'),
              JSON.stringify({ hasAddBtn: pw.hasAddBtn, pickerItems: pw.pickerItems, pickerClosed: pw.pickerClosed, toastText: pw.toastText })
            )
            log('侧栏删除歌单（二次确认后消失）', pw.hasDelBtn === true && pw.gone === true, JSON.stringify({ hasDelBtn: pw.hasDelBtn, gone: pw.gone }))
            await disableFetchMock()
          }

          // 歌单批量选择（体验收尾②）：选择模式 → 勾选/全选 → 加入歌单 → 从歌单移除（写接口全 mock）
          if (DEMO) {
            await enableFetchMock()
            mockQqPlaylistWrite()
            mockQqSquare()
            const sb = await evaluate(
              `(async () => {
                 const sleep = (ms) => new Promise(r => setTimeout(r, ms))
                 const wait = async (fn, tries = 60) => { for (let i = 0; i < tries; i++) { await sleep(200); const v = fn(); if (v) return v } return null }
                 // 0) 新建一个歌单并打开（详情走广场 CgiGetDiss mock，有歌曲可勾选）
                 const newBtn = [...document.querySelectorAll('.sidebar .icon-btn')].find(b => /新建歌单/.test(b.title || ''))
                 newBtn?.click()
                 await wait(() => document.querySelector('.confirm-dialog .confirm-input'))
                 const input = document.querySelector('.confirm-dialog .confirm-input')
                 if (input) {
                   input.value = 'BMP 选择歌单'
                   input.dispatchEvent(new Event('input', { bubbles: true }))
                 }
                 ;[...document.querySelectorAll('.confirm-dialog .dialog-foot .btn')].find(b => /创建/.test(b.textContent))?.click()
                 const createdRow = await wait(() => [...document.querySelectorAll('.playlist-item .pi-name')].find(e => /BMP 选择歌单/.test(e.textContent)))
                 createdRow?.click()
                 await wait(() => document.querySelectorAll('.song-row').length)
                 const total = document.querySelectorAll('.song-row').length
                 // 1) 头部「选择」→ 选择条出现、播放键/行内操作隐藏、勾选框出现
                 const selBtn = [...document.querySelectorAll('.playlist-header .btn')].find(b => /^选择$/.test(b.textContent.trim()))
                 const hasSelBtn = !!selBtn
                 selBtn?.click()
                 await sleep(300)
                 const barVisible = !!document.querySelector('.select-bar')
                 const playMiniHidden = !document.querySelector('.song-row .play-mini')
                 const rowActionsHidden = !document.querySelector('.song-row .row-actions')
                 const pickVisible = !!document.querySelector('.song-row .pick')
                 // 2) 勾选前两行
                 const rows = [...document.querySelectorAll('.song-row')]
                 rows[0]?.click()
                 rows[1]?.click()
                 await sleep(150)
                 const pickedCount = [...document.querySelectorAll('.song-row .pick.on')].length
                 const countText = document.querySelector('.select-bar .sel-count')?.textContent?.trim()
                 // 3) 全选 / 取消全选
                 const allBtn = () => [...document.querySelectorAll('.select-bar .btn')].find(b => /全选|取消全选/.test(b.textContent))
                 allBtn()?.click()
                 await sleep(150)
                 const allText = document.querySelector('.select-bar .sel-count')?.textContent?.trim()
                 allBtn()?.click()
                 await sleep(150)
                 const noneText = document.querySelector('.select-bar .sel-count')?.textContent?.trim()
                 // 4) 再选 2 首 → 加入歌单打开选择器后关闭
                 rows[0]?.click()
                 rows[1]?.click()
                 await sleep(200)
                 const recheckText = document.querySelector('.select-bar .sel-count')?.textContent?.trim()
                 const headerTitle = document.querySelector('.playlist-header h1')?.textContent?.trim() || ''
                 const addBtn = [...document.querySelectorAll('.select-bar .btn')].find(b => /加入歌单/.test(b.textContent))
                 const barBtns = [...document.querySelectorAll('.select-bar .btn')].map(b => (b.disabled ? '!' : '') + b.textContent.replace(/\\s+/g, '').trim())
                 let stepErr = ''
                 let pickerOpened = false
                 let pickerOpenedLate = false
                 let toastText = ''
                 let barGone = false
                 let hasRemove = false
                 try {
                   addBtn?.click()
                   await sleep(300)
                   pickerOpened = !!document.querySelector('.picker-dialog')
                   await sleep(500)
                   pickerOpenedLate = !!document.querySelector('.picker-dialog')
                   document.querySelector('.picker-dialog .icon-btn[title="关闭"]')?.click()
                   await sleep(250)
                   // 5) 「从歌单移除」（自建歌单可见）→ 二次确认 → DelSonglist
                   const rmBtn = [...document.querySelectorAll('.select-bar .btn')].find(b => /从歌单移除/.test(b.textContent))
                   hasRemove = !!rmBtn
                   rmBtn?.click()
                   await wait(() => document.querySelector('.confirm-dialog .dialog-foot .btn'))
                   ;[...document.querySelectorAll('.confirm-dialog .dialog-foot .btn')].find(b => /移除/.test(b.textContent))?.click()
                   await sleep(700)
                   toastText = [...document.querySelectorAll('.toasts > *')].map(t => t.textContent.replace(/\\s+/g, ' ').trim()).join(' | ')
                   barGone = !document.querySelector('.select-bar')
                 } catch (e) {
                   stepErr = String((e && e.message) || e)
                 }
                 // 6) 公开歌单：无「从歌单移除」；「完成」退出
                 location.hash = '#/square'
                 await wait(() => document.querySelectorAll('.sq-card').length, 80)
                 document.querySelector('.sq-card')?.click()
                 await wait(() => document.querySelector('.playlist-header'), 100)
                 await wait(() => document.querySelectorAll('.song-row').length, 80)
                 ;[...document.querySelectorAll('.playlist-header .btn')].find(b => /^选择$/.test(b.textContent.trim()))?.click()
                 await sleep(250)
                 const publicBar = !!document.querySelector('.select-bar')
                 const publicHasRemove = !![...document.querySelectorAll('.select-bar .btn')].find(b => /从歌单移除/.test(b.textContent))
                 ;[...document.querySelectorAll('.select-bar .btn')].find(b => /完成/.test(b.textContent))?.click()
                 await sleep(200)
                 const publicBarGone = !document.querySelector('.select-bar')
                 return { hasSelBtn, barVisible, playMiniHidden, rowActionsHidden, pickVisible, pickedCount, countText, allText, noneText, pickerOpened, hasRemove, toastText, barGone, publicBar, publicHasRemove, publicBarGone, total, headerTitle, recheckText, barBtns, pickerOpenedLate, stepErr }
               })()`,
              { awaitPromise: true }
            )
            log(
              '歌单选择模式：入口 + 勾选 + 全选/取消全选',
              sb.hasSelBtn === true &&
                sb.barVisible === true &&
                sb.playMiniHidden === true &&
                sb.rowActionsHidden === true &&
                sb.pickVisible === true &&
                sb.pickedCount === 2 &&
                sb.countText === '已选 2 首' &&
                sb.allText === '已选 ' + sb.total + ' 首' &&
                sb.noneText === '已选 0 首',
              JSON.stringify(sb)
            )
            log(
              '选择条：加入歌单打开选择器 + 自建歌单有「从歌单移除」',
              sb.pickerOpened === true && sb.hasRemove === true,
              JSON.stringify({ pickerOpened: sb.pickerOpened, hasRemove: sb.hasRemove })
            )
            log(
              '批量从歌单移除（确认后 DelSonglist=2 首）+ 公开歌单无移除入口',
              /已从《BMP 选择歌单》移除 2 首/.test(sb.toastText) &&
                sb.barGone === true &&
                playlistWriteLog.some((w) => w.method === 'DelSonglist' && (w.param.v_songInfo || []).length === 2) &&
                sb.publicBar === true &&
                sb.publicHasRemove === false &&
                sb.publicBarGone === true,
              JSON.stringify({ toastText: sb.toastText, writes: playlistWriteLog.map((w) => w.method), publicHasRemove: sb.publicHasRemove })
            )
            await disableFetchMock()
          }

          // 收藏专辑 / 收藏歌单（P4.2/P4.3）：mock 写接口，验证收藏态回显与切换
          if (DEMO) {
            await enableFetchMock()
            mockQqFavWrite()
            const fw = await evaluate(
              `(async () => {
                 const sleep = (ms) => new Promise(r => setTimeout(r, ms))
                 const wait = async (fn, tries = 60) => { for (let i = 0; i < tries; i++) { await sleep(250); const v = fn(); if (v) return v } return null }
                 // 1) 专辑页收藏切换
                 if (location.hash !== '#/album/0024bjiL2aocxT') location.hash = '#/album/0024bjiL2aocxT'
                 await wait(() => document.querySelector('.ab-head'))
                 const favBtnOf = () => [...document.querySelectorAll('.ab-head .btn')].find(b => /收藏专辑|已收藏/.test(b.textContent))
                 await wait(() => favBtnOf())
                 const albumBefore = favBtnOf()?.textContent?.trim() || ''
                 favBtnOf()?.click()
                 await wait(() => /已收藏/.test(favBtnOf()?.textContent || ''))
                 const albumAfter = favBtnOf()?.textContent?.trim() || ''
                 favBtnOf()?.click()
                 await wait(() => /收藏专辑/.test(favBtnOf()?.textContent || ''))
                 const albumBack = favBtnOf()?.textContent?.trim() || ''
                 // 2) 歌单收藏切换（从广场进入一个公开歌单）
                 location.hash = '#/square'
                 await wait(() => document.querySelectorAll('.sq-card').length, 80)
                 document.querySelector('.sq-card')?.click()
                 await wait(() => document.querySelector('.playlist-header'), 100)
                 const plBtnOf = () => [...document.querySelectorAll('.playlist-header .btn')].find(b => /收藏歌单|取消收藏/.test(b.textContent))
                 await wait(() => plBtnOf())
                 const plBefore = plBtnOf()?.textContent?.trim() || ''
                 plBtnOf()?.click()
                 await wait(() => /取消收藏/.test(plBtnOf()?.textContent || ''))
                 const plAfter = plBtnOf()?.textContent?.trim() || ''
                 plBtnOf()?.click()
                 await wait(() => /收藏歌单/.test(plBtnOf()?.textContent || ''))
                 const plBack = plBtnOf()?.textContent?.trim() || ''
                 return { albumBefore, albumAfter, albumBack, plBefore, plAfter, plBack, toast: [...document.querySelectorAll('.toasts > *')].map(t => t.textContent.replace(/\\s+/g, ' ').trim()).join(' | ') }
               })()`,
              { awaitPromise: true }
            )
            log(
              '专辑页「收藏专辑」切换（mock）',
              fw.albumBefore.includes('收藏专辑') && fw.albumAfter.includes('已收藏') && fw.albumBack.includes('收藏专辑'),
              JSON.stringify({ before: fw.albumBefore, after: fw.albumAfter, back: fw.albumBack, toast: fw.toast })
            )
            log(
              '歌单页「收藏歌单」切换（mock）',
              fw.plBefore.includes('收藏歌单') && fw.plAfter.includes('取消收藏') && fw.plBack.includes('收藏歌单'),
              JSON.stringify({ before: fw.plBefore, after: fw.plAfter, back: fw.plBack })
            )
            await disableFetchMock()
          }

          // 下载与存储（P6）：Web 端隐藏下载入口，存储页显示 Web 提示
          if (DEMO) {
            const st = await evaluate(
              `(async () => {
                 const sleep = (ms) => new Promise(r => setTimeout(r, ms))
                 const wait = async (fn, tries = 40) => { for (let i = 0; i < tries; i++) { await sleep(250); const v = fn(); if (v) return v } return null }
                 const entryOf = () => [...document.querySelectorAll('.sidebar .nav-item, .sidebar .history-item')].find(el => /下载与存储/.test(el.textContent))
                 let entry = entryOf()
                 if (!entry || entry.offsetParent === null) {
                   document.querySelector('.topbar .menu-btn')?.click()
                   await sleep(500)
                   entry = entryOf()
                 }
                 entry?.click()
                 await wait(() => location.hash === '#/storage')
                 const onStorage = location.hash === '#/storage'
                 const hint = document.querySelector('.storage-view .center-msg')?.textContent?.replace(/\\s+/g, ' ').trim() || ''
                 const hasImageClear = !![...document.querySelectorAll('.storage-view .btn')].find(b => /清空图片缓存/.test(b.textContent))
                 // 回主列表，检查 Web 端歌曲行没有下载按钮
                 location.hash = '#/'
                 await wait(() => document.querySelectorAll('.song-row').length)
                 const rowDl = [...document.querySelectorAll('.song-row .icon-btn')].filter(b => /下载/.test(b.title || '')).length
                 return { onStorage, hint, hasImageClear, rowDl }
               })()`,
              { awaitPromise: true }
            )
            log('侧栏进入「下载与存储」（Web 提示）', st.onStorage === true && st.hint.includes('仅 App 支持') && st.hasImageClear === true, JSON.stringify(st))
            log('Web 端隐藏歌曲行下载入口', st.rowDl === 0, String(st.rowDl))
          }

          // 听歌报告（P7.3 G4）：预置本地统计 → 侧栏进入 /report → 汇总 / 排行 / 图表 / 清空
          if (DEMO) {
            await evaluate(
              `(() => {
                 const now = Date.now()
                 const ev = (key, name, singers, at, ms) => ({ key, name, singers, source: 'bili', at, ms })
                 localStorage.setItem('bmp:listen-stats', JSON.stringify([
                   ev('r1', '测试歌A', ['测试歌手'], now - 3600e3, 120000),
                   ev('r1', '测试歌A', ['测试歌手'], now - 2 * 3600e3, 60000),
                   ev('r2', '测试歌B', ['另一位'], now - 25 * 3600e3, 30000),
                 ]))
                 return true
               })()`
            )
            await send('Page.reload')
            await sleep(1400)
            const rp = await evaluate(
              `(async () => {
                 const sleep = (ms) => new Promise(r => setTimeout(r, ms))
                 const wait = async (fn, tries = 40) => { for (let i = 0; i < tries; i++) { await sleep(250); const v = fn(); if (v) return v } return null }
                 const entryOf = () => [...document.querySelectorAll('.sidebar .nav-item, .sidebar .history-item')].find(el => /听歌报告/.test(el.textContent))
                 let entry = entryOf()
                 if (!entry || entry.offsetParent === null) {
                   document.querySelector('.topbar .menu-btn')?.click()
                   await sleep(500)
                   entry = entryOf()
                 }
                 entry?.click()
                 await wait(() => location.hash === '#/report')
                 await wait(() => document.querySelectorAll('.report-view .rp-card').length)
                 const nums = [...document.querySelectorAll('.report-view .rp-num')].map(e => e.textContent.trim())
                 const topName = document.querySelector('.report-view .rp-row .rp-name')?.textContent?.trim() || ''
                 const topVal = document.querySelector('.report-view .rp-row .rp-val')?.textContent?.replace(/\\s+/g, ' ').trim() || ''
                 const hours = document.querySelectorAll('.report-view .rp-bars.hours .rp-bar-wrap').length
                 const days = document.querySelectorAll('.report-view .rp-bars.days .rp-bar-wrap').length
                 const clearBtn = [...document.querySelectorAll('.report-view .btn')].find(b => /清空/.test(b.textContent))
                 clearBtn?.click()
                 await wait(() => document.querySelector('.confirm-dialog'))
                 const dlgTitle = document.querySelector('.confirm-dialog .dialog-head h3')?.textContent?.trim() || ''
                 const okBtn = [...document.querySelectorAll('.confirm-dialog .dialog-foot .btn')].find(b => /清空/.test(b.textContent))
                 okBtn?.click()
                 await sleep(500)
                 const emptyMsg = document.querySelector('.report-view .center-msg')?.textContent?.trim() || ''
                 const lsLen = JSON.parse(localStorage.getItem('bmp:listen-stats') || '[]').length
                 return { onReport: location.hash === '#/report', nums, topName, topVal, hours, days, dlgTitle, emptyMsg, lsLen }
               })()`,
              { awaitPromise: true }
            )
            log(
              '侧栏进入「听歌报告」并渲染汇总卡片',
              rp.onReport === true && rp.nums[0] === '3' && rp.nums[1] === '3 分 30 秒' && rp.nums[2] === '2' && rp.nums[3] === '2',
              JSON.stringify(rp)
            )
            log('歌曲排行（测试歌A 2 次居首）', rp.topName === '测试歌A' && rp.topVal.includes('2 次'), JSON.stringify({ topName: rp.topName, topVal: rp.topVal }))
            log('图表：24 小时分布 + 2 天趋势', rp.hours === 24 && rp.days === 2, JSON.stringify({ hours: rp.hours, days: rp.days }))
            log(
              '清空统计（二次确认 → 空态 + 持久化清空）',
              rp.dlgTitle === '清空听歌统计' && rp.emptyMsg.includes('还没有听歌记录') && rp.lsLen === 0,
              JSON.stringify({ dlgTitle: rp.dlgTitle, emptyMsg: rp.emptyMsg, lsLen: rp.lsLen })
            )
          }

          // 歌单导入导出（P7.4 G5）：导出 Blob 内容 + 文件导入 → 创建歌单
          if (DEMO) {
            await enableFetchMock()
            mockQqPlaylistWrite()
            mockQqSearch()
            mockQqTransfer()
            const tf = await evaluate(
              `(async () => {
                 const sleep = (ms) => new Promise(r => setTimeout(r, ms))
                 const wait = async (fn, tries = 60) => { for (let i = 0; i < tries; i++) { await sleep(250); const v = fn(); if (v) return v } return null }
                 // 1) 打开「我喜欢的音乐」→ 导出 JSON（捕获 Blob 内容）
                 document.querySelector('.sidebar .liked-item')?.click()
                 await wait(() => document.querySelectorAll('.song-row').length)
                 let blobText = ''
                 const orig = URL.createObjectURL.bind(URL)
                 URL.createObjectURL = (b) => { try { b.text().then((t) => { blobText = t }) } catch {} ; return orig(b) }
                 // 导出入口：桌面为「导出」下拉菜单；移动端收敛进「更多」面板
                 const exportBtn = [...document.querySelectorAll('.playlist-header .btn')].find(b => /导出/.test(b.textContent) && b.offsetParent !== null)
                 const moreBtn = [...document.querySelectorAll('.playlist-header .btn')].find(b => /更多/.test(b.textContent) && b.offsetParent !== null)
                 const hasExportBtn = !!exportBtn || !!moreBtn
                 let menuItems = []
                 if (exportBtn) {
                   exportBtn.click()
                   await sleep(300)
                   menuItems = [...document.querySelectorAll('.export-menu .export-item')].map(e => e.textContent.trim())
                   document.querySelector('.export-menu .export-item')?.click()
                 } else if (moreBtn) {
                   moreBtn.click()
                   await wait(() => document.querySelector('.action-sheet'))
                   menuItems = [...document.querySelectorAll('.action-sheet .as-item')].filter(b => /导出/.test(b.textContent)).map(e => e.textContent.trim())
                   const item = [...document.querySelectorAll('.action-sheet .as-item')].find(b => /导出 JSON/.test(b.textContent))
                   item?.click()
                 }
                 await sleep(900)
                 const exportToast = [...document.querySelectorAll('.toasts > *')].map(t => t.textContent.replace(/\\s+/g, ' ').trim()).join(' | ')
                 let parsed = null
                 try { parsed = JSON.parse(blobText) } catch {}
                 // 2) 侧栏导入：构造 m3u 文件（1 条带 mid + 1 条无 mid）→ 确认 → 创建歌单
                 const m3u = ['#EXTM3U', '#PLAYLIST:导入演示', '#EXTINF:269,周杰伦 - 晴天', 'https://y.qq.com/n/ryqq/songDetail/m1', '#EXTINF:200,某歌手 - 未知歌', 'bmp://local/%E6%9C%AA%E7%9F%A5%E6%AD%8C'].join('\\n')
                 const file = new File([m3u], 'demo.m3u', { type: 'audio/x-mpegurl' })
                 const input = document.querySelector('.sidebar input[type=file]')
                 const dt = new DataTransfer()
                 dt.items.add(file)
                 input.files = dt.files
                 input.dispatchEvent(new Event('change', { bubbles: true }))
                 await wait(() => document.querySelector('.confirm-dialog'))
                 const dlgMsg = document.querySelector('.confirm-dialog .confirm-message')?.textContent?.replace(/\\s+/g, ' ').trim() || ''
                 const okBtn = [...document.querySelectorAll('.confirm-dialog .dialog-foot .btn')].find(b => /导入/.test(b.textContent))
                 okBtn?.click()
                 const newRow = await wait(() => [...document.querySelectorAll('.playlist-item .pi-name')].find(e => /导入演示/.test(e.textContent)))
                 const toast = [...document.querySelectorAll('.toasts > *')].map(t => t.textContent.replace(/\\s+/g, ' ').trim()).join(' | ')
                 return { hasExportBtn, menuItems, exportToast, exportCount: parsed?.count || 0, exportFormat: parsed?.format || '', exportNames: (parsed?.songs || []).map(s => s.name), dlgMsg, newRow: newRow?.textContent?.trim() || '', toast }
               })()`,
              { awaitPromise: true }
            )
            log('歌单页导出菜单（JSON / m3u）', tf.hasExportBtn && tf.menuItems.length === 2 && /JSON/.test(tf.menuItems[0]) && /m3u/.test(tf.menuItems[1]), JSON.stringify(tf.menuItems))
            log(
              '导出 JSON：Blob 内容为本应用格式且含歌曲',
              tf.exportFormat === 'bmp-playlist' && tf.exportCount >= 2 && tf.exportNames.length === tf.exportCount && tf.exportNames.every(Boolean) && /已导出/.test(tf.exportToast),
              JSON.stringify({ format: tf.exportFormat, count: tf.exportCount, names: tf.exportNames, toast: tf.exportToast })
            )
            log(
              '导入 m3u：确认弹窗 → 创建歌单并出现在侧栏',
              /导入演示/.test(tf.dlgMsg) && /导入演示/.test(tf.newRow) && /新增 2 首/.test(tf.toast),
              JSON.stringify({ dlgMsg: tf.dlgMsg, newRow: tf.newRow, toast: tf.toast })
            )
            await disableFetchMock()
          }

          // 顶栏语境化：仅歌单页显示「歌单内筛选 + 已匹配 + 一键匹配」
          if (DEMO) {
            const tb = await evaluate(
              `(async () => {
                 const sleep = (ms) => new Promise(r => setTimeout(r, ms))
                 const wait = async (fn, tries = 40) => { for (let i = 0; i < tries; i++) { await sleep(200); const v = fn(); if (v) return v } return null }
                 location.hash = '#/'
                 await sleep(600)
                 const home = {
                   filter: !!document.querySelector('.topbar .search'),
                   badge: !!document.querySelector('.topbar .matched-badge'),
                   match: [...document.querySelectorAll('.topbar .btn')].some(b => /匹配/.test(b.textContent)),
                 }
                 location.hash = '#/search'
                 await wait(() => document.querySelector('.sv-input'))
                 const search = {
                   filter: !!document.querySelector('.topbar .search'),
                   badge: !!document.querySelector('.topbar .matched-badge'),
                   match: [...document.querySelectorAll('.topbar .btn')].some(b => /匹配/.test(b.textContent)),
                   settings: !!document.querySelector('.topbar .icon-btn[title="设置"]'),
                 }
                 location.hash = '#/'
                 await sleep(400)
                 return { home, search }
               })()`,
              { awaitPromise: true }
            )
            log(
              '顶栏语境化：歌单页有筛选/匹配，搜索页隐藏（保留设置）',
              tb.home.filter === true && tb.home.match === true && tb.search.filter === false && tb.search.badge === false && tb.search.match === false && tb.search.settings === true,
              JSON.stringify(tb)
            )
            if (MOBILE) {
              const hdr = await evaluate(
                `(async () => {
                   const sleep = (ms) => new Promise(r => setTimeout(r, ms))
                   const wait = async (fn, tries = 40) => { for (let i = 0; i < tries; i++) { await sleep(200); const v = fn(); if (v) return v } return null }
                   document.querySelector('.sidebar .liked-item')?.click()
                   await wait(() => document.querySelectorAll('.song-row').length)
                   const btns = [...document.querySelectorAll('.playlist-header .btn')].filter(b => b.offsetParent !== null).map(b => b.textContent.replace(/\\s+/g, ' ').trim())
                   const more = [...document.querySelectorAll('.playlist-header .btn')].find(b => /更多/.test(b.textContent) && b.offsetParent !== null)
                   more?.click()
                   await wait(() => document.querySelector('.action-sheet'))
                   const items = [...document.querySelectorAll('.action-sheet .as-item')].map(b => b.textContent.trim())
                   document.querySelector('.action-sheet .as-cancel')?.click()
                   await sleep(250)
                   return { btns, items, closed: !document.querySelector('.action-sheet') }
                 })()`,
                { awaitPromise: true }
              )
              log(
                '歌单头部移动端收敛（播放全部/一键匹配/更多 + 面板含导出/收藏）',
                hdr.btns.length === 3 &&
                  hdr.btns.some((t) => /播放全部/.test(t)) &&
                  hdr.btns.some((t) => /匹配/.test(t)) &&
                  hdr.btns.some((t) => /更多/.test(t)) &&
                  hdr.items.some((t) => /导出 JSON/.test(t)) &&
                  hdr.items.some((t) => /收藏歌单|取消收藏歌单/.test(t)) &&
                  hdr.closed === true,
                JSON.stringify(hdr)
              )
            }
          }

          // 多账号（P7.2 G3）：设置里保存当前账号 → 列表 → 删除
          if (DEMO) {
            const ac = await evaluate(
              `(async () => {
                 const sleep = (ms) => new Promise(r => setTimeout(r, ms))
                 const wait = async (fn, tries = 60) => { for (let i = 0; i < tries; i++) { await sleep(250); const v = fn(); if (v) return v } return null }
                 localStorage.removeItem('bmp:accounts')
                 const settingsBtn = [...document.querySelectorAll('.topbar .icon-btn')].find(b => /设置/.test(b.title || ''))
                 settingsBtn?.click()
                 await wait(() => document.querySelector('.dialog .account-field'))
                 const hasSection = !!document.querySelector('.account-field')
                 const emptyHint = document.querySelector('.account-field .hint')?.textContent?.trim() || ''
                 const saveBtn = [...document.querySelectorAll('.account-field .btn')].find(b => /保存当前账号/.test(b.textContent))
                 const saveDisabled = !!saveBtn?.disabled
                 saveBtn?.click()
                 await sleep(500)
                 const rows = [...document.querySelectorAll('.account-field .acc-row')].map(r => r.textContent.replace(/\\s+/g, ' ').trim())
                 const ls = JSON.parse(localStorage.getItem('bmp:accounts') || '[]')
                 const delBtn = [...document.querySelectorAll('.account-field .acc-row .btn')].find(b => /删除/.test(b.textContent))
                 delBtn?.click()
                 await wait(() => document.querySelector('.confirm-dialog'))
                 const okDel = [...document.querySelectorAll('.confirm-dialog .dialog-foot .btn')].find(b => /删除/.test(b.textContent))
                 okDel?.click()
                 await sleep(500)
                 const rowsAfter = document.querySelectorAll('.account-field .acc-row').length
                 const lsAfter = JSON.parse(localStorage.getItem('bmp:accounts') || '[]').length
                 document.querySelector('.dialog .dialog-head .icon-btn')?.click()
                 return { hasSection, emptyHint, saveDisabled, rows, lsCount: ls.length, rowsAfter, lsAfter }
               })()`,
              { awaitPromise: true }
            )
            log(
              '设置里账号切换区（空态 + 保存当前账号）',
              ac.hasSection && /还没有保存的账号/.test(ac.emptyHint) && ac.rows.length === 1 && ac.lsCount === 1 && /当前账号/.test(ac.rows[0]),
              JSON.stringify(ac)
            )
            log('删除已保存账号（二次确认）', ac.rowsAfter === 0 && ac.lsAfter === 0, JSON.stringify({ rowsAfter: ac.rowsAfter, lsAfter: ac.lsAfter }))
          }

          // P5 E5：设置的「关注的歌手」（只读，mock）
          if (DEMO) {
            await enableFetchMock()
            fetchMockRoutes.push({
              match: (url, postData) => /qqmu-api/.test(url) && /GetFollowSingerList/.test(postData || ''),
              respond: () => loadFixture('qq/followed-singers.json'),
            })
            const fol = await evaluate(
              `(async () => {
                 const sleep = (ms) => new Promise(r => setTimeout(r, ms))
                 const wait = async (fn, tries = 40) => { for (let i = 0; i < tries; i++) { await sleep(200); const v = fn(); if (v) return v } return null }
                 if (!document.querySelector('.dialog')) {
                   const gear = [...document.querySelectorAll('.icon-btn')].find(b => /设置/.test(b.title || ''))
                   gear?.click()
                   await wait(() => document.querySelector('.dialog'))
                 }
                 const load = [...document.querySelectorAll('.dialog .btn')].find(b => /加载关注的歌手/.test(b.textContent))
                 const hasLoad = !!load
                 load?.click()
                 await wait(() => document.querySelectorAll('.follow-item').length)
                 const names = [...document.querySelectorAll('.follow-item .follow-name')].map(e => e.textContent.trim())
                 const hint = [...document.querySelectorAll('.dialog .hint')].map(e => e.textContent.trim()).filter(t => /关注的歌手|加载失败|没有关注|账号/.test(t)).join(' | ')
                 document.querySelector('.dialog .dialog-head .icon-btn')?.click()
                 await sleep(300)
                 return { hasLoad, names, hint }
               })()`,
              { awaitPromise: true }
            )
            log('设置的「关注的歌手」列表（mock，只读）', fol.hasLoad === true && fol.names.length === 2 && fol.names[0] === '周杰伦', JSON.stringify(fol))
            await disableFetchMock()
          }

          // 迷你播放器（P8.2 H2）：Web 隐藏入口（仅 App）
          if (DEMO) {
            const mp = await evaluate(
              `(async () => {
                 const sleep = (ms) => new Promise(r => setTimeout(r, ms))
                 const wait = async (fn, tries = 40) => { for (let i = 0; i < tries; i++) { await sleep(250); const v = fn(); if (v) return v } return null }
                 // 先确保有正在播放的歌曲（首页点第一首）
                 location.hash = '#/'
                 await wait(() => document.querySelectorAll('.song-row').length)
                 document.querySelector('.song-row .play-mini')?.click()
                 await wait(() => { const t = document.querySelector('.np-title')?.textContent?.trim(); return t && t !== '未在播放' })
                 document.querySelector('.player .now-playing')?.click()
                 await wait(() => document.querySelector('.np-foot'))
                 const npTitle = document.querySelector('.np-title')?.textContent?.trim() || ''
                 const queueLS = (() => { try { const q = JSON.parse(localStorage.getItem('bmp:queue') || '{}'); return (q.songs || []).length + '/' + q.index } catch { return 'err' } })()
                 const badge = document.querySelector('.player .queue-count, .player .badge-count')?.textContent?.trim() || ''
                 const barText = document.querySelector('.player .now-playing')?.textContent?.replace(/\\s+/g, ' ').trim().slice(0, 60) || ''
                 const footText = document.querySelector('.np-foot')?.textContent?.replace(/\\s+/g, ' ').trim().slice(0, 80) || ''
                 const titles = [...document.querySelectorAll('.np-foot .np-act')].map(b => b.title || '')
                 const hasMini = titles.some(t => /迷你播放器/.test(t))
                 const hasFav = titles.some(t => /喜欢/.test(t))
                 document.querySelector('.np-top .icon-btn[title="收起"]')?.click()
                 await sleep(300)
                 return { hasMini, hasFav, titles: titles.slice(0, 6), npTitle, footText, queueLS, badge, barText, expanded: !!document.querySelector('.np-foot') }
               })()`,
              { awaitPromise: true }
            )
            log('Web 端隐藏迷你播放器入口（仅 App）', mp.hasMini === false && mp.hasFav === true, JSON.stringify({ hasMini: mp.hasMini, hasFav: mp.hasFav, npTitle: mp.npTitle, queueLS: mp.queueLS, badge: mp.badge, barText: mp.barText }))
          }

          // 逐字歌词（P8.4）：搜索播放「晴天」（fixture mid 命中预置歌词缓存）→ 逐字/罗马音开关
          if (DEMO) {
            await enableFetchMock()
            mockQqSearch()
            const lq = await evaluate(
              `(async () => {
                 const sleep = (ms) => new Promise(r => setTimeout(r, ms))
                 const wait = async (fn, tries = 60) => { for (let i = 0; i < tries; i++) { await sleep(250); const v = fn(); if (v) return v } return null }
                 // 搜索页 → 播放第一条（晴天，mid 0039MnYb0qxYhV）
                 location.hash = '#/search'
                 await wait(() => document.querySelector('.sv-input'))
                 const input = document.querySelector('.sv-input')
                 input.value = '晴天'
                 input.dispatchEvent(new Event('input', { bubbles: true }))
                 await sleep(200)
                 document.querySelector('.sv-go')?.click()
                 await wait(() => document.querySelectorAll('.sv-row .s-actions').length)
                 document.querySelector('.sv-row .s-actions .icon-btn')?.click()
                 await wait(() => /晴天/.test(document.querySelector('.player .now-playing')?.textContent || ''))
                 // 展开播放器并切到歌词视图
                 document.querySelector('.player .now-playing')?.click()
                 await wait(() => document.querySelector('.np-top'))
                 if (!document.querySelector('.np-lyric-list')) {
                   const lyBtn = [...document.querySelectorAll('.np-top .icon-btn')].find(b => /显示歌词/.test(b.title || ''))
                   lyBtn?.click()
                 }
                 await wait(() => document.querySelector('.np-lyric-list'))
                 await wait(() => document.querySelectorAll('.np-lyric-line').length)
                 const lines = document.querySelectorAll('.np-lyric-line').length
                 const emptyText = document.querySelector('.np-lyric-empty')?.textContent?.replace(/\\s+/g, ' ').trim() || ''
                 const npTitle = document.querySelector('.np-title')?.textContent?.trim() || ''
                 const cacheLen = (localStorage.getItem('bmp:lyric4:0039MnYb0qxYhV') || '').length
                 const activeWords = [...document.querySelectorAll('.np-lyric-line.active .l-word')].map(w => w.textContent)
                 // 等第一个「已唱」词出现（demo 每词 1s，播放会推进），用于校验统一配色
                 await wait(() => document.querySelectorAll('.np-lyric-line.active .l-word.done').length, 40)
                 const doneCount = document.querySelectorAll('.np-lyric-line.active .l-word.done').length
                 const activeCount = document.querySelectorAll('.np-lyric-line.active .l-word.active').length
                 const activeEl = document.querySelector('.np-lyric-line.active .l-word.active')
                 const activeStyle = activeEl?.getAttribute('style') || ''
                 const wp1 = parseFloat((activeStyle.match(/--wp:\\s*([\\d.]+)%/) || [])[1] || '-1')
                 const idx1 = [...document.querySelectorAll('.np-lyric-line.active .l-word')].findIndex(w => w.classList.contains('active'))
                 // 播放条进度（用于判断播放是否真的在推进；离线 demo 可能不推进）
                 const fillPct = () => parseFloat((document.querySelector('.player .bar .fill')?.style.width || '0').replace('%', '')) || 0
                 const fill1 = fillPct()
                 await sleep(400)
                 const activeStyle2 = document.querySelector('.np-lyric-line.active .l-word.active')?.getAttribute('style') || ''
                 const wp2 = parseFloat((activeStyle2.match(/--wp:\\s*([\\d.]+)%/) || [])[1] || '-1')
                 const idx2 = [...document.querySelectorAll('.np-lyric-line.active .l-word')].findIndex(w => w.classList.contains('active'))
                 const advanced = idx2 > idx1 || (idx2 === idx1 && wp2 > wp1)
                 const fill2 = fillPct()
                 const playbackAdvanced = fill2 > fill1
                 const advancedOk = advanced || !playbackAdvanced
                 const s2 = {
                   wp1, wp2, idx1, idx2, fill1, fill2,
                   activeEl2: !!document.querySelector('.np-lyric-line.active .l-word.active'),
                   src: document.querySelector('.player .np-sub')?.textContent?.trim() || '',
                 }
                 const hexToRgb = (h) => { const m = String(h).trim().match(/^#([0-9a-f]{6})$/i); if (!m) return ''; const n = parseInt(m[1], 16); return 'rgb(' + ((n >> 16) & 255) + ', ' + ((n >> 8) & 255) + ', ' + (n & 255) + ')' }
                 const rootStyle = getComputedStyle(document.documentElement)
                 const brandRgb = hexToRgb(rootStyle.getPropertyValue('--brand'))
                 const dimRgb = hexToRgb(rootStyle.getPropertyValue('--text-dim'))
                 const doneEl = document.querySelector('.np-lyric-line.active .l-word.done')
                 const unsungEl = [...document.querySelectorAll('.np-lyric-line.active .l-word')].find(w => !w.classList.contains('done') && !w.classList.contains('active'))
                 const doneColor = doneEl ? getComputedStyle(doneEl).color : ''
                 const unsungColor = unsungEl ? getComputedStyle(unsungEl).color : ''
                 const trans = document.querySelector('.np-lyric-line.active .l-trans')?.textContent?.trim() || ''
                 const romaBefore = !!document.querySelector('.np-lyric-line .l-roma')
                 const opts = [...document.querySelectorAll('.lyric-opts .calib-btn')].map(b => b.textContent.trim())
                 const romaBtn = [...document.querySelectorAll('.lyric-opts .calib-btn')].find(b => /罗马音/.test(b.textContent))
                 romaBtn?.click()
                 await sleep(400)
                 const romaAfter = document.querySelector('.np-lyric-line.active .l-roma')?.textContent?.trim() || ''
                 const cfgRoma = JSON.parse(localStorage.getItem('bmp:config') || '{}').lyricRoma
                 const qrcBtn = [...document.querySelectorAll('.lyric-opts .calib-btn')].find(b => /逐字/.test(b.textContent))
                 qrcBtn?.click()
                 await sleep(400)
                 const wordsAfterOff = document.querySelectorAll('.np-lyric-line.active .l-word').length
                 const cfgQrc = JSON.parse(localStorage.getItem('bmp:config') || '{}').lyricQrc
                 qrcBtn?.click()
                 romaBtn?.click()
                 await sleep(300)
                 document.querySelector('.np-top .icon-btn[title="收起"]')?.click()
                 return { lines, activeWords, doneCount, activeCount, activeStyle, advanced, advancedOk, playbackAdvanced, s2, brandRgb, dimRgb, doneColor, unsungColor, trans, romaBefore, opts, romaAfter, cfgRoma, wordsAfterOff, cfgQrc, emptyText, npTitle, cacheLen }
               })()`,
              { awaitPromise: true }
            )
            await disableFetchMock()
            log(
              '逐字渲染：逐词拆分 + 统一配色（已唱=品牌绿）+ 0.1% 进度',
              lq.lines === 4 &&
                lq.activeWords.join('') === '第一句歌词' &&
                lq.activeCount === 1 &&
                /--wp:\s*\d+\.\d%/.test(lq.activeStyle) &&
                lq.unsungColor === lq.dimRgb &&
                (lq.doneCount >= 1 ? lq.doneColor === lq.brandRgb : lq.playbackAdvanced === false) &&
                lq.advancedOk === true,
              JSON.stringify(lq)
            )
            log('逐字渲染：翻译行保留', lq.trans === 'First line', lq.trans)
            log(
              '罗马音开关（默认关 → 打开显示 + 持久化）',
              lq.romaBefore === false && lq.romaAfter === 'dai ichi ku' && lq.cfgRoma === true,
              JSON.stringify({ before: lq.romaBefore, after: lq.romaAfter, cfg: lq.cfgRoma, opts: lq.opts })
            )
            log('逐字开关（关闭 → 行级纯文本 + 持久化）', lq.wordsAfterOff === 0 && lq.cfgQrc === false, JSON.stringify({ wordsAfterOff: lq.wordsAfterOff, cfg: lq.cfgQrc }))
          }

          // 主题（P8.1 H1）：设置里切亮色 → 立即生效 + CSS 变量回归；切暗色 → 持久化到下次加载
          if (DEMO) {
            const th = await evaluate(
              `(async () => {
                 const sleep = (ms) => new Promise(r => setTimeout(r, ms))
                 const wait = async (fn, tries = 60) => { for (let i = 0; i < tries; i++) { await sleep(250); const v = fn(); if (v) return v } return null }
                 const openSettings = () => {
                   const btn = [...document.querySelectorAll('.topbar .icon-btn')].find(b => /设置/.test(b.title || ''))
                   btn?.click()
                 }
                 openSettings()
                 await wait(() => document.querySelector('.dialog select'))
                 const selects = [...document.querySelectorAll('.dialog select')]
                 const themeSel = selects[0]
                 const hasThemeSel = selects.length >= 2 && [...themeSel.options].map(o => o.value).join(',') === 'system,light,dark'
                 themeSel.value = 'light'
                 themeSel.dispatchEvent(new Event('change', { bubbles: true }))
                 await sleep(400)
                 const lightTheme = document.documentElement.dataset.theme
                 const lightBg = getComputedStyle(document.body).backgroundColor
                 const rootStyles = getComputedStyle(document.documentElement)
                 const lineVar = rootStyles.getPropertyValue('--line').trim()
                 const cardVar = rootStyles.getPropertyValue('--card').trim()
                 const hoverVar = rootStyles.getPropertyValue('--hover').trim()
                 themeSel.value = 'dark'
                 themeSel.dispatchEvent(new Event('change', { bubbles: true }))
                 await sleep(400)
                 const darkTheme = document.documentElement.dataset.theme
                 const darkBg = getComputedStyle(document.body).backgroundColor
                 const lsTheme = JSON.parse(localStorage.getItem('bmp:config') || '{}').theme
                 document.querySelector('.dialog .dialog-head .icon-btn')?.click()
                 return { hasThemeSel, lightTheme, lightBg, lineVar, cardVar, hoverVar, darkTheme, darkBg, lsTheme }
               })()`,
              { awaitPromise: true }
            )
            log(
              '主题选择（跟随系统 / 亮色 / 暗色）',
              th.hasThemeSel && th.lightTheme === 'light' && th.lightBg === 'rgb(244, 244, 247)' && th.darkTheme === 'dark' && th.darkBg === 'rgb(18, 18, 22)',
              JSON.stringify({ sel: th.hasThemeSel, light: th.lightTheme + '/' + th.lightBg, dark: th.darkTheme + '/' + th.darkBg })
            )
            log('主题持久化到 bmp:config', th.lsTheme === 'dark', th.lsTheme)
            log(
              '卡片边框回归（--line/--card/--hover 已定义）',
              !!th.lineVar && !!th.cardVar && !!th.hoverVar && /^#|rgb/.test(th.lineVar),
              JSON.stringify({ line: th.lineVar, card: th.cardVar, hover: th.hoverVar })
            )
            await send('Page.reload')
            await sleep(1400)
            const th2 = await evaluate(`({ theme: document.documentElement.dataset.theme, bg: getComputedStyle(document.body).backgroundColor })`)
            log('刷新后仍是暗色（主题持久化生效）', th2.theme === 'dark' && th2.bg === 'rgb(18, 18, 22)', JSON.stringify(th2))
            await evaluate(
              `(() => { const cfg = JSON.parse(localStorage.getItem('bmp:config') || '{}'); cfg.theme = 'system'; localStorage.setItem('bmp:config', JSON.stringify(cfg)); return true })()`
            )
            await send('Page.reload')
            await sleep(1400)
          }

          // 读取诊断面板里的运行时错误（例如 B 站音频流失败原因）
          const diag = await evaluate(
            `(async () => {
               const btn = [...document.querySelectorAll('.user-card .icon-btn')].find(b => /诊断/.test(b.title || ''))
               if (!btn) return { errs: [], noWand: true }
               btn.click()
               await new Promise(r => setTimeout(r, 500))
               const errs = [...document.querySelectorAll('.error-msg')].map(e => e.textContent.trim())
               const checks = [...document.querySelectorAll('.check')].map(c => c.textContent.replace(/\\s+/g, ' ').trim())
               return { errs, checks: checks.slice(0, 12) }
             })()`,
            { awaitPromise: true }
          )
          if (diag.noWand) {
            console.log('SKIP  播放后无运行时错误（未找到诊断按钮）')
          } else {
            // 演示模式用假的 Cookie，QQ/专辑等接口报错是预期的；只关注其它意外错误
            const expectedDemo =
              /接口返回 code=|该视频没有可用的音频流|无法获取视频 cid|privacy|QQ音乐接口请求失败|B 站请求|超时|Failed to fetch|没有可用的音源|豆瓣|正常/
            const realErrs = DEMO ? (diag.errs || []).filter((e) => !expectedDemo.test(e)) : diag.errs || []
            log('播放后无运行时错误', realErrs.length === 0, realErrs.slice(0, 3).join(' | '))
            if (diag.errs?.length) console.log('    诊断错误明细:', JSON.stringify(diag.errs.slice(0, 5)))
          }
          }
        }
      }
      // 与「未登录态」一致：网络抖动导致的上游 4xx/5xx 与超时不算应用异常
      const NET_NOISE_STATUS = '(401|404|500|502|503|504)' // 404：上游（QQ/B站）偶发；本地资源缺失会由断言暴露
      const isNetNoise2 = (s) =>
        isSentinelHit(s) ||
        new RegExp(
          ` ${NET_NOISE_STATUS} |Failed to load resource: the server responded with a status of ${NET_NOISE_STATUS}|net::ERR_|QQ音乐接口请求失败|B 站请求|没有可用的音源|超时|Failed to fetch`
        ).test(s)
      const realConsoleErrors = consoleErrors.filter((e) => !isNetNoise2(e))
      const ignored2 = consoleErrors.length - realConsoleErrors.length
      if (ignored2) console.log(`    （已忽略 ${ignored2} 条网络相关控制台报错）`)
      log('登录态下无 JS 异常', realConsoleErrors.length === 0, realConsoleErrors.slice(0, 3).join(' | '))
      const realFailed = failedRequests.filter((r) => !isSentinelHit(r))
      if (realFailed.length) console.log('    失败请求明细:', JSON.stringify(realFailed.slice(0, 6)))
    }

    console.log(`\n===== UI 测试结果：PASS ${pass} / FAIL ${fail} =====`)
    cleanup()
    process.exit(fail ? 1 : 0)
  } catch (e) {
    console.error('测试异常:', e.message)
    console.error('consoleErrors:', consoleErrors.slice(0, 8))
    cleanup()
    process.exit(1)
  }
})()
