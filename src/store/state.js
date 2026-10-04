/**
 * 全局响应式状态与本地持久化（唯一状态源）。
 * 其它 store 模块只通过这里读写 state / localStorage。
 */
import { reactive } from 'vue'
import { isLikedDirId } from '../api/qq.js'
import { STATS_MAX } from '../api/stats.js'

export const LS = {
  config: 'bmp:config',
  matches: 'bmp:matches',
  user: 'bmp:user',
  userData: 'bmp:userdata',
  /** 单曲音源偏好：{ [songKey]: 'qq' | 'bili' } */
  sourcePref: 'bmp:source-pref',
  /** 播放队列：{ songs: [...], index } */
  queue: 'bmp:queue',
  /** 最近播放（纯本地）：[{ key, song, playedAt }]，最新在前 */
  history: 'bmp:history',
  /** 歌词校准偏移：{ [songKey]: ms }（正 = 歌词延后，补偿 B 站前奏） */
  lyricOffset: 'bmp:lyric-offset',
  /** 全屏播放器是否默认显示歌词（记住上次选择） */
  lyricView: 'bmp:lyric-view',
  /** 桌面歌词（仅 App）开关 */
  desktopLyric: 'bmp:desktop-lyric',
  /** 搜索历史（纯本地） */
  searchHistory: 'bmp:search-history',
  /** 下载索引（P6）：{ [songKey]: { status, path, uri, size, ext, song, source, createdAt, error } } */
  downloads: 'bmp:downloads',
  /** 本地音乐（P6）：[{ key, name, singers, path, uri, size, ext, createdAt }] */
  localMusic: 'bmp:local-music',
  /** 听歌统计（P7.3 G4）：[{ key, name, singers, source, at, ms }]，最新在前 */
  listenStats: 'bmp:listen-stats',
  /** 多账号（P7.2 G3）：[{ id, uin, nickname, avatar, cookie, biliCookie, savedAt }] */
  accounts: 'bmp:accounts',
  /** 迷你播放器（P8.2 H2，仅 App）开关 */
  miniPlayer: 'bmp:mini-player',
}

export function loadLS(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

export function songKey(song) {
  return song.mid || song.id || `${song.name}-${(song.singers || []).join('')}`
}

const savedHistory = loadLS(LS.history, [])

/** 配置默认值：新增字段时与已存配置**合并**，保证老用户也能拿到新默认值 */
const CONFIG_DEFAULTS = {
  qqCookie: '',
  biliCookie: '',
  uin: '',
  euin: '',
  /** 默认播放音源：bili（默认）| qq */
  defaultSource: 'bili',
  /** 实验功能：网页登录时允许点「一键登录」（会尝试拉起手机 QQ） */
  webLoginOneKey: false,
  /** 主题（H1）：system（默认，跟随系统）| light | dark */
  theme: 'system',
  /** 歌词逐字高亮（有 QRC 时生效；默认开） */
  lyricQrc: true,
  /** 歌词罗马音行（默认关，设置里可开） */
  lyricRoma: false,
  /** 最近一次登录方式：qr / web / cookie（随 config 持久化，供诊断展示） */
  loginMethod: '',
}

function loadConfig() {
  const saved = loadLS(LS.config, {})
  return saved && typeof saved === 'object' && !Array.isArray(saved) ? { ...CONFIG_DEFAULTS, ...saved } : { ...CONFIG_DEFAULTS }
}

export const state = reactive({
  config: loadConfig(),
  /** 单曲音源偏好覆盖（用户在播放器上切换后记住） */
  sourcePref: loadLS(LS.sourcePref, {}),
  user: loadLS(LS.user, null),
  /** 最近一次登录方式：qr / web / cookie（启动时从 config 恢复，仅用于诊断展示） */
  loginMethod: '',
  /** 网页登录的落地信息（仅用于诊断展示） */
  webLoginInfo: null,
  /** 访问控制状态（局域网模式下需要输入口令） */
  auth: { reachable: true, required: false, authed: true, checked: false },
  /** 移动端界面状态 */
  ui: {
    sidebarOpen: false,
    playerExpanded: false,
    queueOpen: false,
    /** 全屏播放器显示歌词（默认开，记住上次选择） */
    showLyrics: Boolean(loadLS(LS.lyricView, true)),
    /** 最近一次歌单导出（P7.4 G5，用于 UI 反馈/测试断言） */
    lastExport: null,
    /** 导入进行中（P7.4 G5） */
    importBusy: false,
    importText: '',
    /** 分享面板（P5 E3）：{ open, title, subtitle, url } */
    share: { open: false, title: '', subtitle: '', url: '' },
    },
  loginOpen: false,
  /** 通用二次确认弹窗（P4.0）：由 askConfirm() 驱动，危险操作 confirmText 用红色 */
  confirm: { open: false, title: '', message: '', confirmText: '确认', cancelText: '取消', danger: false, input: null },
  /** 歌单选择弹窗（P4.7）：openPlaylistPicker(songs) 打开 */
  playlistPicker: { open: false, songs: [] },
  /** 通用底部动作面板：openActionSheet({ title, items }) 打开 */
  actionSheet: { open: false, title: '', items: [] },
  /** 「我喜欢」状态缓存（P4.1）：{ [songKey]: boolean } + 进行中的 key */
  fav: { map: {}, pending: {} },
  playlists: [],
  playlist: null,
  songs: [],
  /** 播放队列（显式）：[{ key, song, from: 'list' | 'manual' | 'saved' | 'local' }] */
  queue: [],
  /** 最近播放（纯本地，与 QQ 账号数据无关）：[{ key, song, playedAt }] */
  history: Array.isArray(savedHistory) ? savedHistory : [],
  /** 歌词校准偏移（按歌曲，单位 ms；正 = 歌词延后） */
  lyricOffset: (() => {
    const v = loadLS(LS.lyricOffset, {})
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {}
  })(),
  /** 桌面歌词（仅 App，P2.3）：enabled 开关（持久化），permission 悬浮窗权限 */
  desktopLyric: { enabled: Boolean(loadLS(LS.desktopLyric, false)), permission: false },
  /** 搜索历史（纯本地，最新在前，最多 20 条） */
  searchHistory: Array.isArray(loadLS(LS.searchHistory, [])) ? loadLS(LS.searchHistory, []) : [],
  /** 下载索引（P6）：{ [songKey]: record } */
  downloads: (() => {
    const v = loadLS(LS.downloads, {})
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {}
  })(),
  /** 本地音乐（P6）：导入的本地文件索引 */
  localMusic: Array.isArray(loadLS(LS.localMusic, [])) ? loadLS(LS.localMusic, []) : [],
  /** 下载队列（P6，不持久化）：[{ key, song, status }] */
  downloadQueue: [],
  /** 听歌统计事件（P7.3 G4，纯本地，最新在前）：[{ key, name, singers, source, at, ms }] */
  listenStats: (() => {
    const v = loadLS(LS.listenStats, [])
    return Array.isArray(v) ? v.slice(0, STATS_MAX) : []
  })(),
  /** 已保存账号（P7.2 G3，纯本地）：[{ id, uin, nickname, avatar, cookie, biliCookie, savedAt }] */
  accounts: Array.isArray(loadLS(LS.accounts, [])) ? loadLS(LS.accounts, []) : [],
  /** 迷你播放器（P8.2 H2，仅 App）：开关持久化 */
  miniPlayer: { enabled: Boolean(loadLS(LS.miniPlayer, false)), permission: false },
  likedSongs: [],
  likedCount: 0,
  likedTotal: 0,
  albums: [],
  albumTotal: 0,
  musicLoaded: false,
  filter: '',
  matches: loadLS(LS.matches, {}),
  loading: {
    playlists: false,
    playlist: false,
    matching: false,
    matchDone: 0,
    matchTotal: 0,
  },
  player: {
    index: -1,
    /** 当前在播放队列中的位置（队列是播放顺序的唯一依据） */
    queueIndex: -1,
    /** 帧级插值时间（S3，仅音频源播放中有效；0 = 不使用） */
    smoothTime: 0,
    /** seek 序号：每次 seek 自增，供原生媒体控制立即推送状态（否则系统面板会回弹） */
    seekSeq: 0,
    playing: false,
    loading: false,
    /** 加载中显示的具体文案（如「正在匹配 B 站音源…」） */
    loadingText: '',
    source: 'none',
    duration: 0,
    currentTime: 0,
    fallbackReason: '',
    mode: loadLS(LS.config, {}).playMode || 'order',
  },
  /** 睡眠定时（不持久化，刷新即失效）：minutes 选中的时长，endsAt 到点时间戳，remaining 剩余秒数 */
  sleep: { minutes: 0, endsAt: 0, remaining: 0 },
  /** 当前曲歌词（B1）：{ key, lines: [{ time, text, trans? }], loading, error, source } */
  /** 歌词（P2.1 + P8.4 逐字）：lines[].words 为逐字单元（QRC），trans/roma 为附加文本 */
  lyric: { key: '', lines: [], loading: false, error: '', source: '', qrc: false },
  candidateDialog: {
    open: false,
    songKey: '',
    songName: '',
    keyword: '',
    loading: false,
    list: [],
    requestId: 0,
  },
  diagnostics: {
    open: false,
    running: false,
    ranAt: 0,
    checks: [],
    errors: [],
    verdict: '',
  },
  toasts: [],
})

// 登录方式随 config 持久化：重启（刷新/重开 App）后 Cookie 还在，但登录方式是会话属性，
// 不恢复的话诊断会误报「登录方式：未知」红点。
state.loginMethod = state.config.loginMethod || ''

export function persistConfig() {
  try {
    localStorage.setItem(LS.config, JSON.stringify(state.config))
  } catch {
    /* 配额异常不应打断业务流程 */
  }
}

export function persistMatches() {
  const slim = {}
  for (const [key, value] of Object.entries(state.matches)) {
    const { candidates, ...rest } = value
    slim[key] = rest
  }
  try {
    localStorage.setItem(LS.matches, JSON.stringify(slim))
  } catch {
    /* 超出配额时放弃持久化，不影响本次使用 */
  }
}

/** 缓存「我的音乐」数据，让下次打开时先秒显、再后台刷新。
 *  注意：本次拉取失败时不能把缓存里的好数据覆盖成 0。 */
export function persistUserData() {
  try {
    const prev = loadLS(LS.userData, null)
    const sameUser = prev && prev.uin === state.config.uin
    const data = {
      uin: state.config.uin,
      likedCount: state.likedCount || (sameUser ? prev.likedCount : 0) || 0,
      likedTotal: state.likedTotal || (sameUser ? prev.likedTotal : 0) || 0,
      albumTotal: state.albumTotal || (sameUser ? prev.albumTotal : 0) || 0,
      albums: state.albums.length ? state.albums.slice(0, 200) : sameUser ? prev.albums || [] : [],
      playlists: state.playlists.length ? state.playlists.slice(0, 200) : sameUser ? prev.playlists || [] : [],
      // 缓存曲目本身，这样点「我喜欢」无需等网络、秒开
      likedSongs: state.likedSongs.length ? state.likedSongs.slice(0, 3000) : sameUser ? prev.likedSongs || [] : [],
      savedAt: Date.now(),
    }
    localStorage.setItem(LS.userData, JSON.stringify(data))
  } catch {
    /* 超出配额就放弃缓存 */
  }
}

/** 启动时把上次缓存的数据灌进 state（同步执行，无网络等待） */
function hydrateUserData() {
  const d = loadLS(LS.userData, null)
  if (!d || !d.uin || d.uin !== state.config.uin) return false
  state.likedTotal = d.likedTotal || d.likedCount || 0
  state.likedCount = d.likedCount || d.likedTotal || 0
  if (Array.isArray(d.albums)) {
    state.albums = d.albums
    state.albumTotal = d.albumTotal || d.albums.length
  }
  // 老缓存里可能带着「我喜欢」(201)：侧栏「我的音乐」已单独展示，恢复时顺手剔掉
  if (Array.isArray(d.playlists)) {
    state.playlists = d.playlists.filter((p) => !isLikedDirId(p?.id, p?.dirId))
  }
  if (Array.isArray(d.likedSongs) && d.likedSongs.length) state.likedSongs = d.likedSongs
  return true
}

/** 是否已从缓存恢复过（用于界面显示「加载中」而不是「0 首」） */
export const hydratedFromCache = hydrateUserData()

// 恢复上次的播放队列（只恢复列表与位置，不自动播放）
const savedQueue = loadLS(LS.queue, null)
if (savedQueue && Array.isArray(savedQueue.songs) && savedQueue.songs.length) {
  state.queue = savedQueue.songs.slice(0, 500).map((song) => ({ key: songKey(song), song, from: 'saved' }))
  const i = Number(savedQueue.index)
  state.player.queueIndex = Number.isInteger(i) && i >= 0 && i < state.queue.length ? i : 0
}

export function persistUser() {
  try {
    if (state.user) localStorage.setItem(LS.user, JSON.stringify(state.user))
    else localStorage.removeItem(LS.user)
  } catch {
    /* ignore */
  }
}

export function saveConfig(patch) {
  Object.assign(state.config, patch)
  persistConfig()
}
