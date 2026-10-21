/**
 * 2026-10-21 回归：匹配质量 / 音源切换 / Android 返回键
 * 不依赖网络与浏览器，直接跑纯函数 + 源码守卫。
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import * as match from '../src/utils/match.js'
const { pickBest, rankCandidates } = match
const scoreCandidate = match.scoreCandidate || ((v, s) => ({ score: match.scoreMatch(v, s) + match.scoreDuration(v, s), confidence: 'unknown', eligible: true }))

let pass = 0
let fail = 0
const log = (name, ok, extra = '') => {
  if (ok) pass++
  else fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  — ${extra}` : ''}`)
}
const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8')

console.log('\n=== 1. 匹配质量（平台流量偏置） ===')
{
  const song = { name: '晴天', singers: ['周杰伦'], interval: 269 }
  const wrong = [{ bvid: 'WRONG', title: '周杰伦 稻香', author: '周杰伦', play: 20000000, duration: '3:43' }]
  const best = pickBest(wrong, song)
  log('同歌手但不同歌名 → 拒绝自动匹配', best === null, `picked=${best?.bvid || 'null'}`)
}
{
  const song = { name: '夜に藍', singers: ['月詠み'], interval: 200 }
  const inst = [{ bvid: 'INST', title: '夜に藍 钢琴伴奏 纯音乐', author: 'x', play: 9000000, duration: '3:20' }]
  const best = pickBest(inst, song)
  log('纯音乐/伴奏不再自动当作原曲', best === null, `picked=${best?.bvid || 'null'}`)
}
{
  const song = { name: '晴天', singers: ['周杰伦'], interval: 269 }
  const vids = [
    { bvid: 'OFF', title: '周杰伦《晴天》官方MV', author: '周杰伦', play: 0, duration: '4:29' },
    { bvid: 'COVER', title: '周杰伦 晴天 (女生翻唱)', author: '翻唱UP', play: 9000000, duration: '4:28' },
  ]
  const best = pickBest(vids, song)
  log('官方原版压过高流量翻唱', best?.bvid === 'OFF', `picked=${best?.bvid}`)
  const ranked = rankCandidates(vids, song)
  log('候选列表仍保留翻唱供手动选择', ranked.some((v) => v.bvid === 'COVER'), ranked.map((v) => v.bvid).join('>'))
}
{
  const song = { name: '晴天', singers: ['周杰伦'], interval: 269 }
  const a = { bvid: 'A', title: '周杰伦 晴天', author: '', play: 1000, duration: '4:29' }
  const b = { bvid: 'B', title: '周杰伦 晴天', author: '', play: 1000, duration: '1:09' }
  const ranked = rankCandidates([b, a], song)
  log('时长接近者排前', ranked[0].bvid === 'A', ranked.map((v) => v.bvid).join('>'))
}
{
  const song = { name: 'zzz不存在zzz', singers: ['xxxx'], interval: 100 }
  const v = { bvid: 'X', title: 'Hi-Res 无损 热门歌曲', author: '', play: 9999999, duration: '1:40' }
  const c = scoreCandidate(v, song)
  log('完全不相关→低分且不自动匹配', pickBest([v], song) === null && c.score < 50, `score=${c.score}`)
}
{
  const song = { name: '晴天', singers: ['周杰伦'], interval: 269 }
  const official = { bvid: 'O', title: '周杰伦 晴天 官方', author: '', play: 100, duration: '4:29' }
  const c = scoreCandidate(official, song)
  log('匹配分/置信度可解释', c.score >= 80 && c.confidence === 'high' && c.eligible === true, JSON.stringify(c))
}
{
  const song = { name: 'Lost -Game size-', singers: ['ReoNa'], interval: 250 }
  const ost = {
    bvid: 'OST',
    title: 'Lost -Game size- Tsukihime (月姫) Remake OST',
    author: 'uploader',
    play: 1,
    duration: '4:10',
  }
  const best = pickBest([ost], song)
  log('OST/原声带可作为原曲自动匹配', best?.bvid === 'OST', `picked=${best?.bvid || 'null'}`)
}
{
  const song = { name: 'Lost Dream', singers: ['Juggernaut.', '星名はる'], interval: 268 }
  const plain = { bvid: 'PLAIN', title: 'Lost Dream feat.星名はる', author: 'Jgnt_', play: 4606, duration: '4:28' }
  const full = {
    bvid: 'FULL',
    title: 'Juggernaut. - Lost Dream feat. 星名はる',
    author: 'uploader',
    play: 10866,
    duration: '4:28',
  }
  const best = pickBest([plain, full], song)
  log('完整署名（主唱 - 歌名 feat.）压过仅歌名标题', best?.bvid === 'FULL', `picked=${best?.bvid}`)
  const chart = {
    bvid: 'CHART',
    title: '【maimai自制】Juggernaut. - Lost Dream feat. 星名はる',
    author: 'chart',
    play: 132,
    duration: '4:32',
  }
  const c = scoreCandidate(chart, song)
  log('音游/谱面视频不自动匹配', c.eligible === false, JSON.stringify(c))
}
{
  const song = {
    name: 'Dokimeki Diary',
    singers: ['Miura Jam'],
    aliases: ['ドキメキダイアリー'],
    interval: 196,
  }
  const v = {
    bvid: 'ALIAS',
    title: '【中日歌词】宝可梦地平线OP【心跳日记/ドキメキダイアリー】完整版',
    author: 'uploader',
    play: 1000,
    duration: '3:16',
  }
  const c = scoreCandidate(v, song)
  log('日文别名可高分命中完整版', c.eligible === true && c.score >= 90 && c.reasons.includes('别名命中'), JSON.stringify(c))
}

console.log('\n=== 2. 搜索策略（对抗流量排序） ===')
{
  const bili = read('../src/api/bilibili.js')
  log('搜索请求带时长过滤', /duration/.test(bili) && /searchVideo[\s\S]{0,400}duration/.test(bili))
  log('搜索请求走综合排序而非纯播放量', /order/.test(bili) && /totalrank/.test(bili))
  const player = read('../src/store/player.js')
  log(
    '弱匹配会补搜第二页/关键词变体',
    /fetchPage\([^)]*,\s*2\)/.test(player) && /官方|完整版|高音质/.test(player)
  )
}

console.log('\n=== 3. 音源切换 ===')
{
  const player = read('../src/store/player.js')
  log('切换音源时优先重播当前队列曲目（不再只查 state.songs）', /replayCurrentSong|currentQueueEntry|queueEntry/.test(player))
  log('重播可绕过本地下载（显式选 B 站时生效）', /forceRemote/.test(player))
  log('选择候选视频会立即重播当前曲', /export\s+async\s+function\s+setMatch[\s\S]{0,1500}(replayCurrentSong|forceRemote)/.test(player))
  log('记住用户手动搜索的原名关键词', /matchKeywords\[key\]/.test(player) && /persistMatchKeywords/.test(player))
  log(
    '正在播放时重新匹配会立即换音频',
    /!silent[\s\S]{0,500}replayCurrentSong/.test(player) && /state\.player\.playing/.test(player)
  )
  const cand = read('../src/components/CandidateDialog.vue')
  log('候选弹窗通过 store 选择（历史/队列歌曲也能换源）', /chooseCandidate/.test(cand) && !/state\.songs\.find/.test(cand))
}

console.log('\n=== 4. Android 返回键 ===')
{
  const backPath = new URL('../src/core/back.js', import.meta.url)
  log('返回键适配模块存在', existsSync(backPath))
  if (existsSync(backPath)) {
    const back = readFileSync(backPath, 'utf8')
    const nativeBack = readFileSync(new URL('../src/platform/native/back.js', import.meta.url), 'utf8')
    log(
      '监听 Capacitor backButton（原生适配层）',
      /backButton/.test(nativeBack) && /@capacitor\/app/.test(nativeBack) && /initBackButton/.test(back)
    )
    log('先关闭弹层/播放器再返回上一页', /playerExpanded/.test(back) && /router\.back|router-back/.test(back))
    log('根页面最小化而不是直接退出', /minimizeApp/.test(back))
  }
  const main = read('../src/main.js')
  log('启动时注册返回键处理', /initBackNavigation/.test(main))
  const pkg = JSON.parse(read('../package.json'))
  log('已声明 @capacitor/app 依赖', Boolean(pkg.dependencies?.['@capacitor/app']), String(pkg.dependencies?.['@capacitor/app'] || 'missing'))
}

console.log(`\n===== 结果：PASS ${pass} / FAIL ${fail} =====`)
process.exit(fail ? 1 : 0)
