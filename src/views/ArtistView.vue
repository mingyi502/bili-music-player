<script setup>
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Icon from '../components/Icon.vue'
import AppImage from '../components/AppImage.vue'
import TrackActions from '../components/TrackActions.vue'
import { fetchArtistDetail, fetchArtistSongs, fetchArtistAlbums, fetchSimilarArtists } from '../api/qq/artist.js'
import { state, loadAlbum, playLocalQueue } from '../store/index'

const route = useRoute()
const router = useRouter()

const TABS = [
  { key: 'hot', label: '热门' },
  { key: 'songs', label: '单曲' },
  { key: 'albums', label: '专辑' },
  { key: 'similar', label: '相似歌手' },
]

const tab = ref('hot')
const info = ref(null)
const hotSongs = ref([])
const songs = ref([])
const songTotal = ref(0)
const albums = ref([])
const albumTotal = ref(0)
const similar = ref([])
const loading = ref(false)
const loadingMore = ref(false)
const error = ref('')
const briefOpen = ref(false)
let songBegin = 0

const mid = computed(() => String(route.params.mid || ''))
const list = computed(() => (tab.value === 'hot' ? hotSongs.value : songs.value))

function fmtCount(n) {
  const v = Number(n) || 0
  if (v >= 1e8) return `${(v / 1e8).toFixed(1)} 亿`
  if (v >= 1e4) return `${(v / 1e4).toFixed(1)} 万`
  return String(v)
}

function fmtDuration(sec) {
  if (!sec || !isFinite(sec)) return ''
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

async function load() {
  loading.value = true
  error.value = ''
  info.value = null
  hotSongs.value = []
  songs.value = []
  albums.value = []
  similar.value = []
  songBegin = 0
  tab.value = 'hot'
  try {
    const res = await fetchArtistDetail(mid.value, { cookie: state.config.qqCookie, uin: state.config.uin })
    info.value = res.info
    hotSongs.value = res.hotSongs
  } catch (e) {
    error.value = e.message || '歌手加载失败'
  } finally {
    loading.value = false
  }
}

async function loadTab(key) {
  if (key === tab.value && (key === 'hot' ? hotSongs.value.length : true) && key !== 'songs') return
  tab.value = key
  if (key === 'songs' && !songs.value.length) await loadMoreSongs()
  if (key === 'albums' && !albums.value.length) {
    try {
      const res = await fetchArtistAlbums(mid.value, { cookie: state.config.qqCookie, uin: state.config.uin })
      albums.value = res.albums
      albumTotal.value = res.total
    } catch (e) {
      error.value = e.message || '专辑加载失败'
    }
  }
  if (key === 'similar' && !similar.value.length) {
    try {
      similar.value = await fetchSimilarArtists(mid.value, { cookie: state.config.qqCookie, uin: state.config.uin })
    } catch (e) {
      error.value = e.message || '相似歌手加载失败'
    }
  }
}

async function loadMoreSongs() {
  if (loadingMore.value) return
  loadingMore.value = true
  try {
    const res = await fetchArtistSongs(mid.value, { begin: songBegin, num: 30, cookie: state.config.qqCookie, uin: state.config.uin })
    songs.value = songs.value.concat(res.songs)
    songTotal.value = res.total
    songBegin += res.songs.length
  } catch (e) {
    error.value = e.message || '单曲加载失败'
  } finally {
    loadingMore.value = false
  }
}

function playAt(i) {
  playLocalQueue(list.value, i)
}

function playAll() {
  if (list.value.length) playLocalQueue(list.value, 0)
}

function openAlbum(al) {
  if (al.mid) router.push(`/album/${al.mid}`)
  else loadAlbum(al).then(() => router.push('/')).catch(() => {})
}

watch(mid, () => {
  if (mid.value) load()
})
if (mid.value) load()
</script>

<template>
  <div class="artist-view">
    <div v-if="loading" class="center-msg">
      <div>
        <span class="spin"><Icon name="refresh" :size="30" /></span>
        <div style="margin-top: 10px">正在加载歌手…</div>
      </div>
    </div>

    <div v-else-if="error && !info" class="sv-error">{{ error }}</div>

    <template v-else-if="info">
      <div class="ar-head">
        <AppImage class="ar-avatar" :src="info.avatar" alt="" placeholder />
        <div class="ar-meta">
          <div class="ar-name">
            {{ info.name }}
            <span v-if="info.otherName" class="ar-other">{{ info.otherName }}</span>
          </div>
          <div class="ar-sub">
            <span v-if="info.fans">粉丝 {{ fmtCount(info.fans) }}</span>
            <span>{{ info.totalSong }} 首单曲</span>
            <span>{{ info.totalAlbum }} 张专辑</span>
            <span v-if="info.totalMv">{{ info.totalMv }} 个 MV</span>
          </div>
          <div v-if="info.brief" class="ar-brief" :class="{ open: briefOpen }" @click="briefOpen = !briefOpen">
            {{ info.brief }}
            <span class="ar-more">{{ briefOpen ? '收起' : '展开' }}</span>
          </div>
        </div>
        <button class="btn primary" :disabled="!list.length" @click="playAll">
          <Icon name="play" :size="15" /> 播放
        </button>
      </div>

      <div class="sv-tabs">
        <button v-for="t in TABS" :key="t.key" class="sv-tab" :class="{ on: tab === t.key }" @click="loadTab(t.key)">
          {{ t.label }}
          <span v-if="t.key === 'songs' && songTotal" class="sv-total">{{ songTotal }}</span>
          <span v-else-if="t.key === 'albums' && albumTotal" class="sv-total">{{ albumTotal }}</span>
        </button>
      </div>

      <div v-if="error" class="sv-error">{{ error }}</div>

      <!-- 热门 / 单曲 -->
      <template v-if="tab === 'hot' || tab === 'songs'">
        <div v-for="(s, i) in list" :key="s.mid || s.id || i" class="rk-row" @click="playAt(i)">
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
        <div class="sv-more">
          <button v-if="tab === 'songs' && songs.length < songTotal" class="btn ghost" :disabled="loadingMore" @click="loadMoreSongs">
            <Icon :name="loadingMore ? 'refresh' : 'chevronDown'" :size="14" :class="{ spin: loadingMore }" />
            {{ loadingMore ? '加载中…' : '加载更多' }}
          </button>
          <span v-else-if="tab === 'songs'" class="sv-hint">已加载 {{ songs.length }} / {{ songTotal }}</span>
        </div>
      </template>

      <!-- 专辑 -->
      <div v-else-if="tab === 'albums'" class="sq-grid">
        <div v-for="al in albums" :key="al.mid || al.id" class="sq-card" @click="openAlbum(al)">
          <div class="sq-cover-wrap">
            <AppImage class="sq-cover" :src="al.cover" alt="" placeholder />
            <span class="sq-play"><Icon name="play" :size="18" /></span>
          </div>
          <div class="sq-name">{{ al.name }}</div>
          <div class="sq-meta"><span>{{ al.pubtime }}</span><span v-if="al.songCount">· {{ al.songCount }} 首</span></div>
        </div>
      </div>

      <!-- 相似歌手 -->
      <div v-else class="ar-similar">
        <div v-for="sg in similar" :key="sg.mid || sg.id" class="ar-sim-card" @click="router.push(`/artist/${sg.mid}`)">
          <AppImage class="ar-sim-avatar" :src="sg.avatar" alt="" placeholder />
          <div class="ar-sim-name">{{ sg.name }}</div>
        </div>
      </div>
    </template>
  </div>
</template>
