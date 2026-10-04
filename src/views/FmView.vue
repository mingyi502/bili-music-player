<script setup>
import { onMounted, ref, watch } from 'vue'
import Icon from '../components/Icon.vue'
import AppImage from '../components/AppImage.vue'
import TrackActions from '../components/TrackActions.vue'
import { fetchFmBatch, FM_BATCH } from '../api/qq/fm.js'
import { state, songKey, playLocalQueue, appendToQueue } from '../store/index'

const songs = ref([])
const loading = ref(false)
const appending = ref(false)
const error = ref('')
/** 本次会话出现过的 mid（永不重复） */
const seen = new Set()
/** 队列里属于 FM 的条目 key（用于判断「当前在听 FM」） */
const fmKeys = new Set()
let nextPage = 1

async function loadMore(size = FM_BATCH) {
  const res = await fetchFmBatch({
    startPage: nextPage,
    size,
    exclude: seen,
    cookie: state.config.qqCookie,
    uin: state.config.uin,
  })
  nextPage = res.nextPage
  for (const s of res.songs) seen.add(s.mid)
  songs.value = songs.value.concat(res.songs)
  return res.songs
}

async function init() {
  loading.value = true
  error.value = ''
  songs.value = []
  seen.clear()
  nextPage = 1
  try {
    await loadMore()
  } catch (e) {
    error.value = e.message || '私人 FM 加载失败'
  } finally {
    loading.value = false
  }
}

/** 不喜欢：移除并补一首新的（该 mid 不再出现） */
function dislike(song) {
  songs.value = songs.value.filter((s) => s.mid !== song.mid)
  loadMore(1).catch(() => {})
}

function playAll() {
  if (!songs.value.length) return
  playLocalQueue(songs.value, 0)
  fmKeys.clear()
  for (const e of state.queue) fmKeys.add(e.key)
}

function playAt(i) {
  playLocalQueue(songs.value, i)
  fmKeys.clear()
  for (const e of state.queue) fmKeys.add(e.key)
}

function fmtDuration(sec) {
  if (!sec || !isFinite(sec)) return ''
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

/** 连续播放：当前在听 FM 且队列剩余 ≤4 首时自动补货（不重复） */
watch(
  () => [state.player.queueIndex, state.queue.length],
  async () => {
    const qi = state.player.queueIndex
    const current = state.queue[qi]
    if (!current || !fmKeys.has(current.key)) return
    if (state.queue.length - qi > 4 || appending.value) return
    appending.value = true
    try {
      const fresh = await loadMore()
      for (const entry of appendToQueue(fresh)) fmKeys.add(entry.key)
    } catch {
      /* 补货失败不影响当前播放 */
    } finally {
      appending.value = false
    }
  }
)

onMounted(init)
</script>

<template>
  <div class="fm-view">
    <div class="dy-head">
      <div class="dy-icon"><Icon name="shuffle" :size="22" /></div>
      <div class="dy-meta">
        <div class="dy-title">私人 FM</div>
        <div class="dy-sub">连续播放 · 不重复 · 不喜欢会换一首</div>
      </div>
      <div class="dy-actions">
        <button class="btn ghost" :disabled="loading || appending" @click="loadMore()">
          <Icon name="refresh" :size="14" :class="{ spin: appending }" /> 换一批
        </button>
        <button class="btn primary" :disabled="!songs.length" @click="playAll">
          <Icon name="play" :size="15" /> 播放
        </button>
      </div>
    </div>

    <div v-if="error" class="sv-error">{{ error }}</div>

    <div v-if="loading" class="center-msg">
      <div>
        <span class="spin"><Icon name="refresh" :size="30" /></span>
        <div style="margin-top: 10px">正在为你准备电台…</div>
      </div>
    </div>

    <template v-else-if="songs.length">
      <div v-for="(s, i) in songs" :key="s.mid || s.id || i" class="rk-row" @click="playAt(i)">
        <div class="rk-rank">{{ i + 1 }}</div>
        <AppImage class="s-cover" :src="s.cover" alt="" placeholder />
        <div class="s-main">
          <div class="s-name">{{ s.name }}</div>
          <div class="s-sub">{{ s.singers.join(' / ') || '未知歌手' }}</div>
        </div>
        <div class="s-album" :title="s.album">{{ s.album || '—' }}</div>
        <div class="s-time">{{ fmtDuration(s.interval) }}</div>
        <TrackActions :song="s" @play="playAt(i)">
          <button class="icon-btn" title="不喜欢（换一首）" @click="dislike(s)"><Icon name="trash" :size="15" /></button>
        </TrackActions>
      </div>
      <div class="sv-hint" style="text-align: center; padding: 14px 0">
        连续播放时会自动补歌；{{ songs.length }} 首待播
      </div>
    </template>

    <div v-else-if="!loading" class="center-msg">
      <div>
        <div class="big"><Icon name="shuffle" :size="46" /></div>
        <div>暂时没有电台内容，稍后再试</div>
      </div>
    </div>
  </div>
</template>
