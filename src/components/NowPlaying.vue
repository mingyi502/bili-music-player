<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import Icon from './Icon.vue'
import AppImage from './AppImage.vue'
import LyricLine from './LyricLine.vue'
import SleepTimerButton from './SleepTimerButton.vue'
import { useImage } from '../utils/mediaCache'
import { findLineIndex, lyricDurationMismatch, toLyricTime, toSeekTime } from '../utils/lrc'
import { hasMediaControl } from '../core/mediaControl.js'
import {
  state,
  store,
  togglePlay,
  next,
  prev,
  seek,
  seekRatio,
  cycleMode,
  collapsePlayer,
  matchSong,
  openCandidateDialog,
  switchCurrentSource,
  sourceFor,
  toggleQueue,
  loadLyric,
  lyricOffsetFor,
  setLyricOffset,
  resetLyricOffset,
  setShowLyrics,
  toggleDesktopLyric,
  favOf,
  favPending,
  toggleFav,
  refreshFavStates,
  hasDownloads,
  isDownloaded,
  isDownloading,
  downloadSong,
  removeDownload,
  hasMiniPlayer,
  toggleMiniPlayer,
  setLyricQrc,
  setLyricRoma,
  lyricNow,
} from '../store/index'

/** 桌面歌词 / 通知栏控制仅 App 有（Web 隐藏入口） */
const nativeMedia = hasMediaControl()

const router = useRouter()

/** 打开歌曲详情页（带展示信息；评论/相似歌曲按数字 id 拉取） */
function openSongDetail(songRef) {
  if (!songRef?.id) return
  router.push({
    path: `/song/${songRef.id}`,
    query: {
      mid: songRef.mid || '',
      name: songRef.name || '',
      singers: (songRef.singers || []).join('/'),
      album: songRef.album || '',
      albumMid: songRef.albumMid || '',
      cover: songRef.cover || '',
      interval: songRef.interval || 0,
    },
  })
}

/** 当前曲的红心状态未知时按 mid 拉一次（失败静默） */
const song = computed(() => store.currentSong.value)
watch(
  () => song.value?.mid,
  (mid) => {
    if (mid && state.fav.map[mid] === undefined) refreshFavStates([song.value])
  },
  { immediate: true }
)

const video = computed(() => store.currentVideo.value)
const cover = computed(() => song.value?.cover || video.value?.cover || '')
/** 这首歌当前会用的音源（含用户偏好） */
const prefSource = computed(() => (song.value ? sourceFor(song.value) : 'bili'))

/** 下载状态（P6，仅 App 显示入口） */
const canDownload = computed(() => hasDownloads())
const downloaded = computed(() => (song.value ? isDownloaded(song.value) : false))
const downloading = computed(() => (song.value ? isDownloading(song.value) : false))
async function onDownload() {
  if (!song.value || downloading.value) return
  if (downloaded.value) await removeDownload(song.value)
  else await downloadSong(song.value)
}
// 背景大图与封面共用同一份解析结果
const bgUrl = useImage(() => cover.value)
const canSeek = computed(() => state.player.source === 'qq' || state.player.source === 'bili' || state.player.source === 'local')
const modeLabel = computed(
  () => ({ order: '顺序播放', repeat: '单曲循环', shuffle: '随机播放' })[state.player.mode] || '顺序播放'
)
const modeIcon = computed(
  () => ({ order: 'repeat', repeat: 'repeatOne', shuffle: 'shuffle' })[state.player.mode] || 'repeat'
)

// ── 歌词视图（B3）────────────────────────────────────────────────────────
// 默认显示歌词，用户切换后记住（state.ui.showLyrics 持久化）
const showLyrics = computed({
  get: () => state.ui.showLyrics,
  set: (v) => setShowLyrics(v),
})
const lyricEl = ref(null)
const lyricLines = computed(() => state.lyric.lines)
/** 歌词校准偏移（S1）：正 = 歌词延后 */
const offsetMs = computed(() => (song.value ? lyricOffsetFor(song.value) : 0))
const offsetLabel = computed(() => {
  const ms = offsetMs.value
  if (!ms) return '未校准'
  const s = (ms / 1000).toFixed(1)
  return ms > 0 ? `+${s}s 延后` : `${s}s 提前`
})
const currentLine = computed(() => findLineIndex(state.lyric.lines, lyricTime.value))
/** 当前「歌词时间」（秒，含校准偏移）；逐字高亮同样用它（iframe 源走本地外推） */
const lyricTime = computed(() => toLyricTime(lyricNow.value, offsetMs.value))
/** 逐字（QRC）与罗马音显示开关（持久化在 config；逐字默认开、罗马音默认关） */
const karaokeOn = computed(() => Boolean(state.config.lyricQrc) && Boolean(state.lyric.qrc))
const showRoma = computed(() => Boolean(state.config.lyricRoma))
const hasRoma = computed(() => state.lyric.lines.some((l) => l.roma))
function toggleQrc() {
  setLyricQrc(!state.config.lyricQrc)
}
function toggleRoma() {
  setLyricRoma(!state.config.lyricRoma)
}

watch(currentLine, async (i) => {  if (!showLyrics.value || i < 0) return
  await nextTick()
  lyricEl.value?.children?.[i]?.scrollIntoView({ block: 'center', behavior: 'smooth' })
})
watch(showLyrics, async (on) => {
  if (!on) return
  await nextTick()
  const i = currentLine.value
  if (i >= 0) lyricEl.value?.children?.[i]?.scrollIntoView({ block: 'center' })
})

function seekLine(line) {
  if (line) seek(toSeekTime(line.time, offsetMs.value))
}

/** 歌词校准：deltaSec 为秒（±0.5s），store 会夹取到 ±30s 并持久化 */
function nudgeOffset(deltaSec) {
  if (!song.value) return
  setLyricOffset(song.value, Math.round(deltaSec * 1000))
}
function resetOffset() {
  if (song.value) resetLyricOffset(song.value)
}

// 长按连续调整：按下先走一步，500ms 后每 150ms 一步（调大偏移不用手点）
let holdTimer = null
let repeatTimer = null
function startNudge(deltaSec) {
  nudgeOffset(deltaSec)
  stopNudge()
  holdTimer = setTimeout(() => {
    repeatTimer = setInterval(() => nudgeOffset(deltaSec), 150)
  }, 500)
}
function stopNudge() {
  if (holdTimer) {
    clearTimeout(holdTimer)
    holdTimer = null
  }
  if (repeatTimer) {
    clearInterval(repeatTimer)
    repeatTimer = null
  }
}
onBeforeUnmount(stopNudge)

/** B 站视频与原曲时长差异（>5s 提示可能是不同版本） */
const durationMismatch = computed(() => lyricDurationMismatch(song.value?.interval, state.player.duration))

/** 歌词加载失败时手动重试（不切歌也能恢复） */
function retryLyric() {
  if (song.value) loadLyric(song.value, { force: true })
}

// 左右滑动切换：左滑看歌词、右滑回封面；下滑收起播放器（触屏）
let touchStartX = 0
let touchStartY = 0
function onTouchStart(e) {
  touchStartX = e.changedTouches?.[0]?.clientX || 0
  touchStartY = e.changedTouches?.[0]?.clientY || 0
}
function onTouchEnd(e) {
  const x = e.changedTouches?.[0]?.clientX || 0
  const y = e.changedTouches?.[0]?.clientY || 0
  const dx = x - touchStartX
  const dy = y - touchStartY
  // 纵向明显下滑（超过 70px 且垂直位移大于水平位移 1.4 倍）：收起播放器
  if (dy > 70 && Math.abs(dy) > Math.abs(dx) * 1.4) {
    collapsePlayer()
    return
  }
  if (Math.abs(dx) > 60) showLyrics.value = dx < 0
}

const barEl = ref(null)
const dragging = ref(false)
const dragRatio = ref(0)
/** 拖动中只本地预览（跟手指），松手才真正 seek */
const displayRatio = computed(() => (dragging.value ? dragRatio.value : store.progress.value / 100))
const displayElapsed = computed(() =>
  dragging.value ? dragRatio.value * (store.currentDuration.value || 0) : store.elapsed.value
)

function fmt(sec) {
  if (!sec || !isFinite(sec)) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}
function ratioAt(clientX) {
  const el = barEl.value
  if (!el) return 0
  const r = el.getBoundingClientRect()
  return Math.max(0, Math.min(1, (clientX - r.left) / r.width))
}
function onDown(e) {
  if (!canSeek.value) return
  dragging.value = true
  dragRatio.value = ratioAt(e.clientX)
  try {
    barEl.value?.setPointerCapture?.(e.pointerId)
  } catch {
    /* 合成事件 / 指针已失效时忽略 */
  }
}
function onMove(e) {
  if (dragging.value) dragRatio.value = ratioAt(e.clientX)
}
function onUp() {
  if (!dragging.value) return
  dragging.value = false
  seekRatio(dragRatio.value)
}
</script>

<template>
  <div v-if="state.ui.playerExpanded && song" class="now-playing-full">
    <div class="np-bg" :style="bgUrl ? { backgroundImage: `url(${bgUrl})` } : {}"></div>
    <div class="np-content">
      <div class="np-top">
        <button class="icon-btn" title="收起" @click="collapsePlayer">
          <Icon name="chevronDown" :size="24" />
        </button>
        <span class="np-top-title">{{ song.name }}</span>
        <button class="icon-btn" title="重新匹配" @click="matchSong(song)">
          <Icon name="refresh" :size="18" />
        </button>
        <button class="icon-btn" title="搜索并选择 B 站视频" @click="openCandidateDialog(song)">
          <Icon name="search" :size="18" />
        </button>
        <a
          v-if="video"
          class="icon-btn"
          :href="video.url"
          target="_blank"
          rel="noreferrer"
          title="在 B 站打开视频"
        >
          <Icon name="video" :size="18" />
        </a>
        <SleepTimerButton />
        <button
          class="icon-btn"
          :class="{ on: showLyrics }"
          :title="showLyrics ? '显示封面' : '显示歌词'"
          @click="showLyrics = !showLyrics"
        >
          <Icon name="lyrics" :size="18" />
        </button>
        <button v-if="song?.id" class="icon-btn" title="歌曲详情" @click="openSongDetail(song)">
          <Icon name="external" :size="18" />
        </button>
      </div>

      <div class="np-stage" @touchstart.passive="onTouchStart" @touchend.passive="onTouchEnd">
        <div v-if="!showLyrics" class="np-cover-wrap" title="点击查看歌词" @click="showLyrics = true">
          <AppImage v-if="cover" class="np-cover" :src="cover" alt="" :lazy="false" />
          <div v-else class="np-cover np-cover-empty"><Icon name="music" :size="56" /></div>
          <div class="np-cover-hint"><Icon name="lyrics" :size="13" /> 歌词</div>
        </div>

        <div v-else class="np-lyric-wrap">
          <div v-if="state.lyric.loading" class="np-lyric-empty">
            <span class="spin"><Icon name="refresh" :size="22" /></span>
            <div>正在加载歌词…</div>
          </div>
          <div v-else-if="!lyricLines.length" class="np-lyric-empty">
            <Icon name="music" :size="34" />
            <div>{{ state.lyric.error || '暂无歌词' }}</div>
            <button v-if="song.mid" class="btn ghost sm" @click="retryLyric">
              <Icon name="refresh" :size="13" /> 重试
            </button>
          </div>
          <div v-else ref="lyricEl" class="np-lyric-list">
            <LyricLine
              v-for="(line, i) in lyricLines"
              :key="i"
              :line="line"
              :active="i === currentLine"
              :karaoke="karaokeOn"
              :show-roma="showRoma"
              :offset-ms="offsetMs"
              @seek="seekLine"
            />
          </div>
          <!-- 歌词工具条（P8.4）：逐字/罗马音 + 校准 + 桌面歌词合并为一行，给歌词留出空间 -->
          <div v-if="lyricLines.length" class="lyric-calib lyric-opts lyric-tools" @click.stop>
            <button v-if="state.lyric.qrc" class="calib-btn" :class="{ on: karaokeOn }" title="逐字高亮（QRC）" @click="toggleQrc">逐字</button>
            <button v-if="hasRoma" class="calib-btn" :class="{ on: showRoma }" title="显示罗马音" @click="toggleRoma">罗马音</button>
            <span v-if="state.lyric.qrc || hasRoma" class="tool-sep"></span>
            <button
              class="calib-btn"
              data-delta="-0.5"
              title="歌词提前 0.5 秒（长按连续）"
              @pointerdown.prevent="startNudge(-0.5)"
              @pointerup="stopNudge"
              @pointerleave="stopNudge"
              @pointercancel="stopNudge"
            >
              −0.5s
            </button>
            <span class="calib-value" :title="`歌词校准：${offsetLabel}（B站音源可能有前奏偏移）`">{{ offsetLabel }}</span>
            <button
              class="calib-btn"
              data-delta="0.5"
              title="歌词延后 0.5 秒（长按连续）"
              @pointerdown.prevent="startNudge(0.5)"
              @pointerup="stopNudge"
              @pointerleave="stopNudge"
              @pointercancel="stopNudge"
            >
              +0.5s
            </button>
            <button class="calib-btn calib-icon calib-reset" :disabled="!offsetMs" title="重置校准" @click="resetOffset">
              <Icon name="refresh" :size="13" />
            </button>
            <button
              v-if="nativeMedia"
              class="calib-btn calib-icon desktop-lyric-btn"
              :class="{ on: state.desktopLyric.enabled }"
              title="桌面歌词（系统悬浮窗，退出 App 后显示）"
              @click="toggleDesktopLyric"
            >
              <Icon name="desktopLyric" :size="14" />
            </button>
          </div>
          <div v-if="lyricLines.length && durationMismatch" class="lyric-hint">
            与原曲时长相差 {{ durationMismatch }}s，可能是不同版本：可校准或换匹配
          </div>
        </div>

        <div class="np-meta" @click="showLyrics = !showLyrics">
          <div v-if="!showLyrics" class="np-song">{{ song.name }}</div>
          <div class="np-singer">{{ song.singers.join(' / ') || '未知歌手' }}</div>
          <div v-if="video" class="np-bili" :title="video.title">B站：{{ video.title }}</div>
        </div>
      </div>

      <div class="np-progress">
        <div
          ref="barEl"
          class="bar np-bar"
          :class="{ static: !canSeek, dragging }"
          @pointerdown="onDown"
          @pointermove="onMove"
          @pointerup="onUp"
          @pointercancel="onUp"
        >
          <div class="fill" :style="{ width: displayRatio * 100 + '%' }" />
        </div>
        <div class="np-times">
          <span>{{ fmt(displayElapsed) }}</span>
          <span>{{ fmt(store.currentDuration.value) }}</span>
        </div>
      </div>

      <div class="np-controls">
        <button class="ctrl np-side" :class="{ on: state.player.mode !== 'order' }" :title="modeLabel" @click="cycleMode">
          <Icon :name="modeIcon" :size="22" />
        </button>
        <button class="ctrl np-side" title="上一首" @click="prev"><Icon name="prev" :size="30" /></button>
        <button class="ctrl np-play" :disabled="!state.queue.length" @click="togglePlay">
          <Icon
            :name="state.player.loading ? 'refresh' : state.player.playing ? 'pause' : 'play'"
            :size="30"
            :class="{ spin: state.player.loading }"
          />
        </button>
        <button class="ctrl np-side" title="下一首" @click="next"><Icon name="next" :size="30" /></button>
        <button class="ctrl np-side" :class="{ on: state.ui.queueOpen }" title="播放队列" @click="toggleQueue">
          <Icon name="playlist" :size="22" />
        </button>
      </div>

      <div class="np-foot">
        <div class="np-acts">
          <button
            v-if="canDownload && song"
            class="icon-btn np-act"
            :class="{ on: downloaded }"
            :disabled="downloading"
            :title="downloaded ? '已下载（点击删除）' : downloading ? '下载中…' : '下载到本机（离线可听）'"
            @click.stop="onDownload"
          >
            <Icon :name="downloaded ? 'check' : downloading ? 'refresh' : 'download'" :size="18" :class="{ spin: downloading }" />
          </button>
          <button
            v-if="song"
            class="icon-btn np-act fav-btn"
            :class="{ on: favOf(song) }"
            :disabled="favPending(song)"
            :title="favOf(song) ? '取消喜欢' : '加入我喜欢'"
            @click.stop="toggleFav(song)"
          >
            <Icon name="heart" :size="18" />
          </button>
          <button
            v-if="song"
            class="icon-btn np-act"
            :class="prefSource"
            :title="`当前音源：${prefSource === 'qq' ? 'QQ音乐' : 'B站'}，点击切换`"
            @click="switchCurrentSource"
          >
            <Icon :name="prefSource === 'qq' ? 'qqMusic' : 'bilibili'" :size="20" class="np-src-icon" />
          </button>
          <button
            v-if="hasMiniPlayer()"
            class="icon-btn np-act"
            :class="{ on: state.miniPlayer.enabled }"
            :title="state.miniPlayer.enabled ? '关闭迷你播放器' : '迷你播放器（悬浮小窗，仅 App）'"
            @click.stop="toggleMiniPlayer()"
          >
            <Icon name="floatLyric" :size="18" />
          </button>
        </div>
        <span v-if="state.player.source === 'local'" class="badge ok">本地播放</span>
        <span v-if="state.player.source === 'iframe'" class="badge loading">内嵌播放（不可拖动）</span>
        <span v-else-if="state.player.loading && state.player.loadingText" class="badge loading">
          <span class="spin"><Icon name="refresh" :size="12" /></span> {{ state.player.loadingText }}
        </span>
        <span v-if="state.player.fallbackReason" class="np-hint">{{ state.player.fallbackReason }}</span>
      </div>
    </div>
  </div>
</template>
