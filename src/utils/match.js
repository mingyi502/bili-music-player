/**
 * B 站匹配打分。
 *
 * 背景：B 站搜索默认按「综合/流量」排序，播放量高的翻唱、伴奏、剪辑或
 * 同歌手的其它歌经常排在最前。这里把「文本命中 / 歌手命中 / 时长 / 版本」
 * 拆成可解释的分项：
 *  - 自动匹配只接受「原曲/官方/完整音频」；翻唱、伴奏、教学、鬼畜、直播、
 *    片段等仍会出现在候选列表，但不会自动选中；
 *  - 播放量只给很小的加分，避免流量机制直接决定匹配结果；
 *  - 输出 score / confidence / eligible，供 UI 标记「匹配存疑」。
 */
const PUNCT = /[【】\[\]（）()《》<>「」『』"'`.,!?、,~～\-_|/\\:：;；·•+&@#%^*=]/g
const OFFICIAL_RE = /官方|official|原版|正版|版权方|歌手官方|工作室/i
const TECH_RE = /mv|m\/v|高清|超清|4k|8k|1080p|720p|60fps|hdr|hi-?res|无损|高音质|完整版|动态歌词|歌词版|字幕|中文字幕|国语|修复|纯享|杜比|全景声|音频/i
/** 能证明「这是完整音频而不是二创/现场/其它歌手版本」的标签 */
const AUDIO_QUALITY_RE =
  /无损|高音质|hi-?res|完整版|官方|official|原版|正版|音频|动态歌词|歌词版|歌词向|\bost\b|soundtrack|original\s*soundtrack|原声|原声带|主题曲|主题歌|片头曲|片尾曲|插入歌/i

const TECH_TAG_RE = /(【[^】]*】|\[[^\]]*\]|（[^）]*）|\([^)]*\)|「[^」]*」|『[^』]*』)/g
const TECH_TAG_ONLY_RE =
  /^(?:(?:4k|8k|1080p|720p|60fps|hdr|hi-?res|无损|高音质|高清|超清|蓝光|官方|official|mv|完整版|动态歌词|歌词版|歌词|字幕|中文字幕|中日双语|双语|国语|修复|纯享|杜比|全景声|收藏|搬运|分p|高清版|音频|无损音质|正版|原版)+)$/i

/** 去掉只包含技术标签的括号，如【4K修复】【官方MV】【Hi-Res】；
 *  括号里若是歌名/歌手（如【周杰伦】）则保留，避免误删有效信息。 */
export function stripTechTags(title) {
  return String(title || '').replace(TECH_TAG_RE, (raw) => {
    const inner = raw
      .slice(1, -1)
      .replace(/[\s\-_|/\\·•+&@#%^*,，、;；:：~～]/g, '')
      .toLowerCase()
    return inner && TECH_TAG_ONLY_RE.test(inner) ? ' ' : raw
  })
}

export function normalize(str) {
  return String(str || '')
    .toLowerCase()
    .replace(PUNCT, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokens(str) {
  return normalize(str)
    .split(' ')
    .filter((t) => t.length > 0)
}

export function parseDuration(str) {
  if (typeof str === 'number') return str
  const parts = String(str || '')
    .split(':')
    .map((n) => parseInt(n, 10) || 0)
  return parts.reduce((acc, n) => acc * 60 + n, 0)
}

export function isCandidate(video) {
  const sec = parseDuration(video.duration)
  return sec === 0 || (sec >= 20 && sec <= 20 * 60)
}

/**
 * B 站上「不是原曲」的常见标题特征。
 * 这些规则只影响自动匹配；候选列表仍会保留，用户可手动选择。
 * 如果歌曲本身就叫「翻唱 / 伴奏 / Live」，则对应规则不生效。
 */
const NEGATIVE_RULES = [
  { key: 'cover', label: '翻唱/改编', penalty: 70, re: /(翻唱|翻自|cover|covered|女声版|男声版|童声版|合唱版|改编|acoustic|不插电|翻弹|弹唱|吉他弹唱|同人版|弾いてみた|歌ってみた|演奏してみた|踊ってみた|翻跳|宅舞|wota艺|駅名記憶|替え歌)/i },
  { key: 'instrumental', label: '伴奏/纯音乐', penalty: 75, re: /(伴奏|纯音乐|instrumental|off\s*vocal|karaoke|ktv|钢琴版|吉他版|口琴|八音盒|尤克里里|古筝|小提琴|大提琴|长笛|萨克斯|music\s*box|钢琴曲|吉他曲|演奏版|演奏|管乐团|交响|吹奏|乐队版)/i },
  { key: 'tutorial', label: '教学/谱', penalty: 85, re: /(教学|教程|简谱|吉他谱|钢琴谱|指弹谱|鼓谱|总谱|乐队谱|和弦谱|五线谱|\btab\b|tab谱|bass\s*tab|如何弹|弹唱教学|谱子)/i },
  { key: 'meme', label: '鬼畜/搞笑', penalty: 90, re: /(鬼畜|恶搞|搞笑|整活|沙雕|meme|梗曲|抽象)/i },
  { key: 'remix', label: '混音/变速', penalty: 65, re: /(remix|混音|dj|夜店|慢摇|8d|环绕音|降调|升调|变速|加快版|减速版|鬼畜)/i },
  { key: 'compilation', label: '合集/串烧', penalty: 60, re: /(合集|串烧|连播|歌单|精选集|一小时|循环播放|playlist|full\s*album)/i },
  { key: 'liveStream', label: '直播/录播', penalty: 80, re: /(直播|录播|回放|直播回放)/i },
  { key: 'clip', label: '片段/剪辑', penalty: 60, re: /(片段|剪辑|混剪|试听|副歌|切片|30秒|一分钟|高潮版|\bcut\b)/i },
  { key: 'reaction', label: '解说/测评', penalty: 80, re: /(reaction|解说|分析|乐评|赏析|测评|\brank\b|排行)/i },
  { key: 'liveVersion', label: '现场版', penalty: 35, re: /(现场|live|演唱会|音乐节|concert|演出|公演)/i },
  { key: 'chart', label: '音游/谱面', penalty: 85, re: /(maimai|adofai|arcaea|osu!?|beatmap|custom\s*chart|自制|创作谱面|合作谱|谱面|初谱|落榜|冰与火|冰與火|\bcdf\d*\b|击破|擊破|准度|準度|完美无瑕|无\s*ui\s*演示|手元|プレイ)/i },
]

function negativeHits(video, song) {
  const text = `${video.title || ''} ${video.author || ''}`
  const songText = String(song.name || '')
  const hits = []
  for (const rule of NEGATIVE_RULES) {
    // 歌曲本身就是翻唱/伴奏/Live 时，不把对应词当成错误版本
    if (rule.re.test(songText)) continue
    if (rule.re.test(text)) hits.push(rule)
  }
  return hits
}

function positiveBonus(video) {
  const text = String(video.title || '')
  const author = String(video.author || '')
  let score = 0
  if (OFFICIAL_RE.test(text)) score += 10
  if (TECH_RE.test(text)) score += 6
  if (/动态歌词|歌词版|歌词向|完整版/i.test(text)) score += 4
  if (/官方|official|歌手|工作室|版权/i.test(author)) score += 4
  return score
}

/** 主唱出现在歌名之前（如「Juggernaut. - Lost Dream」）通常是完整署名，给少量加分 */
function primaryArtistBonus(title, name, singers) {
  const primary = singers[0]
  if (!primary || !title.includes(primary)) return 0
  const artistAt = title.indexOf(primary)
  const songAt = name ? title.indexOf(name) : -1
  return songAt < 0 || artistAt < songAt ? 4 : 0
}

/** 基础分：歌名 + 歌手 + 版本/官方标签 + 很弱的播放量加分 */
export function scoreMatch(video, song) {
  const rawTitle = String(video.title || '')
  const title = normalize(stripTechTags(rawTitle))
  const names = [song.name, ...(song.aliases || [])].map(normalize).filter(Boolean)
  const name = names[0] || ''
  const singers = (song.singers || []).map(normalize).filter(Boolean)
  const author = normalize(video.author)
  let score = 0
  let nameExact = false
  let nameCoverage = 0
  let singerMatched = false
  const matchedName = names.find((n) => title.includes(n)) || ''

  if (matchedName) {
    nameExact = true
    nameCoverage = 1
    score += 62
  } else {
    const nameTokens = tokens(song.name)
    if (nameTokens.length) {
      const hit = nameTokens.filter((t) => title.includes(t)).length
      nameCoverage = hit / nameTokens.length
      score += nameCoverage * 42
    }
  }

  const singerInTitle = singers.filter((s) => title.includes(s))
  const singerInAuthor = singers.filter((s) => author.includes(s))
  if (singerInTitle.length) {
    singerMatched = true
    // 合作曲把多位歌手都写进标题是「更完整」的署名，不应反而扣分
    score += 30 + Math.min(6, Math.max(0, singerInTitle.length - 1) * 3)
  } else {
    const singerTokens = singers.flatMap(tokens)
    if (singerTokens.length) {
      const hit = singerTokens.filter((t) => title.includes(t)).length
      score += (hit / singerTokens.length) * 14
      if (hit / singerTokens.length >= 0.6) singerMatched = true
    }
    if (singerInAuthor.length) {
      singerMatched = true
      score += 14
    }
  }

  score += primaryArtistBonus(title, matchedName || name, singers)

  // 2 字歌名非常容易命中无关标题；没有歌手佐证时降低权重
  if (name.length <= 2 && nameExact && !singerMatched) score -= 14

  score += positiveBonus(video)

  for (const rule of negativeHits(video, song)) score -= rule.penalty

  // 流量只给最多 10 分，避免高播放的无关视频靠流量压过原曲
  score += Math.min(10, Math.log10((video.play || 0) + 1) * 2)
  return Math.max(0, score)
}

/** 时长越接近歌曲时长，得分越高（模糊匹配，不要求一致） */
export function scoreDuration(video, song) {
  const songSec = Number(song.interval) || 0
  const vidSec = parseDuration(video.duration)
  if (!songSec || !vidSec) return 0
  const diff = Math.abs(songSec - vidSec)
  if (diff <= 2) return 26
  if (diff <= 6) return 20
  if (diff <= 12) return 14
  if (diff <= 25) return 7
  if (diff <= 45) return 0
  if (diff <= 90) return -8
  return -20
}

/** 时长加分只在已有文字命中时才生效，避免「不相关但时长凑巧一致」被误判为匹配 */
const DURATION_GATE = 25

function confidenceOf({ score, nameExact, singerMatched, durationClose }) {
  if (score >= 85 && nameExact && singerMatched && durationClose) return 'high'
  if (score >= 65) return 'medium'
  return 'low'
}

/**
 * 单条候选的完整评分（供匹配、候选列表和测试共用）。
 * @returns {{score:number, confidence:'high'|'medium'|'low', eligible:boolean, nameExact:boolean, singerMatched:boolean, reasons:string[]}}
 */
export function scoreCandidate(video, song) {
  const rawTitle = String(video.title || '')
  const title = normalize(stripTechTags(rawTitle))
  const names = [song.name, ...(song.aliases || [])].map(normalize).filter(Boolean)
  const name = names[0] || ''
  const singers = (song.singers || []).map(normalize).filter(Boolean)
  const author = normalize(video.author)

  const matchedName = names.find((n) => title.includes(n)) || ''
  const nameExact = Boolean(matchedName)
  const nameTokens = tokens(song.name)
  const nameCoverage = nameExact
    ? 1
    : nameTokens.length
      ? nameTokens.filter((t) => title.includes(t)).length / nameTokens.length
      : 0
  const singerMatched = singers.some((s) => title.includes(s) || author.includes(s))
  const primaryLead = primaryArtistBonus(title, matchedName || name, singers) > 0
  const songSec = Number(song.interval) || 0
  const vidSec = parseDuration(video.duration)
  const durationDiff = songSec && vidSec ? Math.abs(songSec - vidSec) : null
  // 时长差 30s 以上往往意味着现场/TV/剪辑版；仍可播放，但不算高可信
  const durationClose = durationDiff == null || durationDiff <= 30

  let score = scoreMatch(video, song)
  if (score >= DURATION_GATE) score += scoreDuration(video, song)

  const negatives = negativeHits(video, song)
  const reasons = []
  if (nameExact) reasons.push(matchedName !== name ? '别名命中' : '歌名命中')
  if (singerMatched) reasons.push('歌手命中')
  if (primaryLead) reasons.push('主唱前置')
  if (negatives.length) reasons.push(...negatives.map((n) => n.label))

  // 现场/TV 演出与翻唱、伴奏一样不自动选中：音质、编曲、时长都和录音室版不同，
  // 候选列表里仍保留，用户想听现场版可以手动点。
  const hardNegative = negatives.length > 0
  // 自动匹配必须有足够的文字命中；同歌手的不同歌（歌名没命中）不能直接播。
  // 歌名命中但歌手没出现时，只有标题带「无损/完整版/官方/音频」等完整音频
  // 证据才允许自动选中——避免把「中森明菜版」「站名记忆」这类二创当成原曲。
  const textStrong = nameExact || nameCoverage >= 0.8
  const singerMissing = singers.length > 0 && !singerMatched
  const audioEvidence = AUDIO_QUALITY_RE.test(rawTitle)
  const eligible = textStrong && !hardNegative && (!singerMissing || audioEvidence)

  return {
    score: Math.max(0, Math.round(score * 10) / 10),
    confidence: confidenceOf({ score, nameExact, singerMatched, durationClose }),
    eligible,
    nameExact,
    singerMatched,
    durationDiff,
    reasons,
  }
}

/** 候选列表：可自动匹配的排前面，其余按分数排；翻唱/伴奏仍保留供手动选择 */
export function rankCandidatesScored(videos, song) {
  return (videos || [])
    .filter(isCandidate)
    .map((video) => ({ video, ...scoreCandidate(video, song) }))
    .sort((a, b) => {
      if (a.eligible !== b.eligible) return a.eligible ? -1 : 1
      return b.score - a.score
    })
}

export function rankCandidates(videos, song) {
  return rankCandidatesScored(videos, song).map((x) => x.video)
}

/** 低于该分数视为没有合适的匹配，避免仅凭播放量错配 */
export const MIN_SCORE = 55

export function pickBest(videos, song) {
  const ranked = rankCandidatesScored(videos, song).filter((x) => x.eligible)
  const top = ranked[0]
  if (!top || top.score < MIN_SCORE) return null
  return top.video
}

export function buildKeyword(song) {
  const singer = (song.singers || []).join(' ')
  return `${song.name} ${singer}`.trim()
}
