/**
 * 运行时回归：返回键决策 + 手动换源写入 + 实际音源判定。
 * 纯 Node，不启动浏览器；播放器音频部分由源码守卫覆盖。
 */
import { state, setLikedMids } from '../src/store/state.js'
import { handleBack, decideBackAction } from '../src/core/back.js'
import { setMatch, currentActualSource, chooseCandidate, matchForDisplay } from '../src/store/player.js'
import { favOf } from '../src/store/fav.js'
import { decidePlayerSwipe } from '../src/utils/playerSwipe.js'

let pass = 0
let fail = 0
const log = (name, ok, extra = '') => {
  if (ok) pass++
  else fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  — ${extra}` : ''}`)
}

console.log('\n=== 返回键优先级 ===')
{
  const cases = [
    [{ overlay: 'player', canGoBack: true, path: '/search' }, 'close-overlay'],
    [{ overlay: '', canGoBack: true, path: '/search' }, 'minimize'],
    [{ overlay: '', canGoBack: true, path: '/history' }, 'minimize'],
    [{ overlay: '', canGoBack: true, path: '/song/1' }, 'router-back'],
    [{ overlay: '', canGoBack: false, path: '/song/1' }, 'home'],
    [{ overlay: '', canGoBack: false, path: '/' }, 'minimize'],
  ]
  for (const [input, expected] of cases) {
    const got = decideBackAction(input).type
    log(`${JSON.stringify(input)} → ${expected}`, got === expected, got)
  }
}
{
  state.ui.playerExpanded = true
  state.ui.queueOpen = false
  state.ui.sidebarOpen = false
  let routerBack = 0
  let minimized = 0
  const action = await handleBack({
    router: { currentRoute: { value: { path: '/search' } }, back: () => routerBack++, replace: async () => {} },
    app: { minimizeApp: async () => minimized++ },
  })
  log('全屏播放器打开时返回先收起播放器', action.type === 'close-overlay' && !state.ui.playerExpanded && routerBack === 0 && minimized === 0)
}
{
  state.ui.playerExpanded = false
  state.ui.queueOpen = true
  const action = await handleBack({
    router: { currentRoute: { value: { path: '/search' } }, back: () => {}, replace: async () => {} },
    app: { minimizeApp: async () => {} },
  })
  log('队列打开时返回先收起队列', action.type === 'close-overlay' && !state.ui.queueOpen)
}
{
  state.ui.queueOpen = false
  let replaced = ''
  const action = await handleBack({
    router: { currentRoute: { value: { path: '/song/1' } }, back: () => {}, replace: async (p) => { replaced = p } },
    app: { minimizeApp: async () => {} },
  })
  log('深链无历史时返回首页而不是桌面', action.type === 'home' && replaced === '/', replaced)
}
{
  let minimized = 0
  const action = await handleBack({
    router: { currentRoute: { value: { path: '/' } }, back: () => {}, replace: async () => {} },
    app: { minimizeApp: async () => minimized++ },
  })
  log('首页返回最小化而不是退出', action.type === 'minimize' && minimized === 1)
}

console.log('\n=== 手动换源写入 ===')
{
  const song = { mid: 'm-test', name: '测试曲', singers: ['测试歌手'], interval: 200 }
  state.matches = {}
  state.sourcePref = {}
  state.queue = [{ key: 'm-test', song, from: 'list' }]
  state.player.queueIndex = 0
  state.player.index = -1
  state.player.source = 'iframe'
  const ok = await setMatch(song, { bvid: 'BV-NEW', title: '测试曲 官方', author: '测试歌手', duration: '3:20' }, { replay: false })
  log('setMatch 写入新 bvid', ok && state.matches['m-test']?.bvid === 'BV-NEW', state.matches['m-test']?.bvid)
  log('setMatch 记住 B 站偏好', state.sourcePref['m-test'] === 'bili', state.sourcePref['m-test'])
  log('setMatch 标记手动/高分', state.matches['m-test']?.manual === true && state.matches['m-test']?.confidence === 'high')
  await setMatch(
    song,
    { bvid: 'BV-SHORT', title: 'DOKIMEKI DIARY', author: 'x', duration: '1:28', matchScore: 45.4, matchConfidence: 'low' },
    { replay: false }
  )
  log(
    '手动选择短剪辑保留低可信度',
    state.matches['m-test']?.confidence === 'low' && state.matches['m-test']?.score === 45.4,
    JSON.stringify({ confidence: state.matches['m-test']?.confidence, score: state.matches['m-test']?.score })
  )
}
{
  const song = { mid: 'm-test', name: '测试曲', singers: ['测试歌手'], interval: 200 }
  log('iframe 播放归为 B 站实际音源', currentActualSource(song) === 'bili', currentActualSource(song))
  state.player.source = 'qq'
  log('QQ 播放显示 QQ 实际音源', currentActualSource(song) === 'qq')
  state.player.source = 'local'
  log('本地播放显示 local', currentActualSource(song) === 'local')
  state.player.source = 'none'
  log('未播放时无实际音源', currentActualSource(song) === null)
}
{
  // 历史/播放队列里的歌不在 state.songs 中，也必须能通过候选弹窗换源
  const song = { mid: 'm-queue', name: '队列曲', singers: ['队列歌手'], interval: 180 }
  state.songs = []
  state.queue = [{ key: 'm-queue', song, from: 'history' }]
  state.player.queueIndex = -1
  state.player.index = -1
  state.candidateDialog = { open: true, songKey: 'm-queue', songName: song.name, list: [], requestId: 0 }
  const ok = await chooseCandidate({
    bvid: 'BV-QUEUE',
    title: '队列曲 官方',
    author: '队列歌手',
    duration: '3:00',
  })
  log('队列/历史歌曲可换源', ok === true && state.matches['m-queue']?.bvid === 'BV-QUEUE', state.matches['m-queue']?.bvid)
  log('选择后自动关闭候选弹窗', state.candidateDialog.open === false)
}

console.log('\n=== 收藏状态 / 歌词手势 ===')
{
  const a = { mid: 'm-liked', name: '已喜欢', singers: ['A'] }
  const b = { mid: 'm-other', name: '未喜欢', singers: ['B'] }
  setLikedMids([a])
  log('「我喜欢」列表成员红心回显', favOf(a) === true && favOf(b) === false, `${favOf(a)}/${favOf(b)}`)
  state.fav.map['m-other'] = false
  log('接口 false 不覆盖已确认的喜欢', favOf(a) === true)
}
{
  const inLyrics = decidePlayerSwipe({ dx: 0, dy: 220, inLyrics: true, height: 800 })
  const shortDown = decidePlayerSwipe({ dx: 0, dy: 120, height: 800 })
  const longDown = decidePlayerSwipe({ dx: 0, dy: 180, height: 800 })
  const left = decidePlayerSwipe({ dx: -130, dy: 30, height: 800 })
  const right = decidePlayerSwipe({ dx: 130, dy: 30, height: 800 })
  log('歌词区纵向滑动不收起', inLyrics === 'none', inLyrics)
  log('非歌词区短下拉不收起、长下拉才收起', shortDown === 'none' && longDown === 'collapse', `${shortDown}/${longDown}`)
  log('横向左右滑仍可切歌词/封面', left === 'lyrics' && right === 'cover', `${left}/${right}`)
}
{
  const song = { mid: 'm-legacy', name: 'Caramel Drizzle Love', singers: ['初音未来', 'Proby'], interval: 200 }
  state.matches['m-legacy'] = {
    status: 'ok',
    title: '【初音未来】Caramel Syndrome【R Sound Design】',
    author: 'uploader',
    play: 1000,
    duration: '3:10',
  }
  const m = matchForDisplay(song)
  log('旧缓存错配按新规则标为存疑', m && m.legacy === true && m.confidence !== 'high' && m.eligible === false, JSON.stringify(m))
}

console.log(`\n===== 结果：PASS ${pass} / FAIL ${fail} =====`)
process.exit(fail ? 1 : 0)
