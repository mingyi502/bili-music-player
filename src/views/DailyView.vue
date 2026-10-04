<script setup>
import { computed, onMounted, ref } from 'vue'
import Icon from '../components/Icon.vue'
import AppImage from '../components/AppImage.vue'
import TrackActions from '../components/TrackActions.vue'
import { fetchDailySongs } from '../api/qq/daily.js'
import { state, store, playLocalQueue } from '../store/index'

const songs = ref([])
const loading = ref(false)
const error = ref('')
const loggedIn = computed(() => store.isLoggedIn.value)

const today = new Date()
const dateText = `${today.getMonth() + 1} 月 ${today.getDate()} 日`

async function load() {
  loading.value = true
  error.value = ''
  try {
    const res = await fetchDailySongs({ cookie: state.config.qqCookie, uin: state.config.uin })
    songs.value = res.songs
  } catch (e) {
    error.value = e.message || '每日推荐加载失败'
    songs.value = []
  } finally {
    loading.value = false
  }
}

function playAll() {
  if (songs.value.length) playLocalQueue(songs.value, 0)
}

function playAt(i) {
  playLocalQueue(songs.value, i)
}

function fmtDuration(sec) {
  if (!sec || !isFinite(sec)) return ''
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

onMounted(load)
</script>

<template>
  <div class="daily-view">
    <div class="dy-head">
      <div class="dy-icon"><Icon name="wand" :size="22" /></div>
      <div class="dy-meta">
        <div class="dy-title">每日推荐</div>
        <div class="dy-sub">根据你的收听口味生成 · {{ dateText }} 更新</div>
      </div>
      <div class="dy-actions">
        <button v-if="!loggedIn" class="btn ghost" @click="state.loginOpen = true">
          <Icon name="music" :size="14" /> 登录后更懂你
        </button>
        <button class="btn ghost" :disabled="loading" @click="load">
          <Icon name="refresh" :size="14" :class="{ spin: loading }" /> 换一批
        </button>
        <button class="btn primary" :disabled="!songs.length" @click="playAll">
          <Icon name="play" :size="15" /> 播放全部
        </button>
      </div>
    </div>

    <div v-if="error" class="sv-error">{{ error }}</div>

    <div v-if="loading" class="center-msg">
      <div>
        <span class="spin"><Icon name="refresh" :size="30" /></span>
        <div style="margin-top: 10px">正在生成今日推荐…</div>
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
        <TrackActions :song="s" @play="playAt(i)" />
      </div>
      <div class="sv-hint" style="text-align: center; padding: 14px 0">共 {{ songs.length }} 首 · 每次进入都会更新</div>
    </template>

    <div v-else-if="!loading" class="center-msg">
      <div>
        <div class="big"><Icon name="wand" :size="46" /></div>
        <div>暂时没有推荐，稍后再试</div>
      </div>
    </div>
  </div>
</template>
