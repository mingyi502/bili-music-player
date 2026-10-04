<script setup>
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import Icon from '../components/Icon.vue'
import AppImage from '../components/AppImage.vue'
import TrackActions from '../components/TrackActions.vue'
import { fetchAlbumSongs, fetchAlbumDetail } from '../api/qq/album.js'
import { state, playLocalQueue, isAlbumFav, toggleFavAlbum } from '../store/index'

const route = useRoute()

const songs = ref([])
const base = ref(null)
const meta = ref(null)
const loading = ref(false)
const error = ref('')

const mid = computed(() => String(route.params.mid || ''))
const title = computed(() => meta.value?.name || base.value?.name || '未知专辑')
const tranName = computed(() => (meta.value?.tranName && meta.value.tranName !== title.value ? meta.value.tranName : ''))
const cover = computed(() => meta.value?.cover || base.value?.cover || songs.value[0]?.cover || '')
const singers = computed(() => {
  if (meta.value?.singers?.length) return meta.value.singers.join(' / ')
  if (base.value?.nick) return base.value.nick
  return '未知歌手'
})
const pubtime = computed(() => meta.value?.pubtime || base.value?.pubtime || '')
const desc = computed(() => meta.value?.desc || base.value?.desc || '')
const descOpen = ref(false)

/** 收藏目标（D2）：优先用 musicu 详情里的数字 albumID */
const favTarget = computed(() => ({
  id: String(meta.value?.id || base.value?.id || ''),
  mid: meta.value?.mid || '',
  name: title.value,
  cover: cover.value,
  singers: meta.value?.singers?.length ? meta.value.singers : base.value?.nick ? [base.value.nick] : [],
  songCount: songs.value.length,
  pubtime: pubtime.value,
}))

function fmtDuration(sec) {
  if (!sec || !isFinite(sec)) return ''
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

async function load() {
  loading.value = true
  error.value = ''
  songs.value = []
  base.value = null
  meta.value = null
  descOpen.value = false
  const id = mid.value
  if (!id) {
    error.value = '缺少专辑 ID'
    loading.value = false
    return
  }
  try {
    const res = await fetchAlbumSongs(id, state.config.qqCookie)
    base.value = res.playlist
    songs.value = res.songs
  } catch (e) {
    error.value = e.message || '专辑加载失败'
  } finally {
    loading.value = false
  }
  // 元信息增强失败不影响歌曲展示
  try {
    meta.value = await fetchAlbumDetail(id, { cookie: state.config.qqCookie, uin: state.config.uin })
  } catch {
    meta.value = null
  }
}

function playAll() {
  if (songs.value.length) playLocalQueue(songs.value, 0)
}

function playAt(i) {
  playLocalQueue(songs.value, i)
}

watch(mid, () => {
  if (mid.value) load()
})
if (mid.value) load()
</script>

<template>
  <div class="album-view">
    <div v-if="loading" class="center-msg">
      <div>
        <span class="spin"><Icon name="refresh" :size="30" /></span>
        <div style="margin-top: 10px">正在加载专辑…</div>
      </div>
    </div>

    <div v-else-if="error && !songs.length" class="sv-error">{{ error }}</div>

    <template v-else>
      <div class="ab-head">
        <AppImage class="ab-cover" :src="cover" alt="" placeholder />
        <div class="ab-meta">
          <div class="ab-tag">Album</div>
          <div class="ab-name">
            {{ title }}
            <span v-if="tranName" class="ab-tran">{{ tranName }}</span>
          </div>
          <div class="ab-sub">
            <span>{{ singers }}</span>
            <span v-if="pubtime">{{ pubtime }} 发行</span>
            <span>{{ songs.length }} 首歌曲</span>
            <span v-if="meta?.genre">{{ meta.genre }}</span>
          </div>
          <div v-if="meta?.company" class="ab-company">{{ meta.company }}</div>
          <div v-if="desc" class="ab-desc" :class="{ open: descOpen }" @click="descOpen = !descOpen">
            {{ desc }}
            <span class="ar-more">{{ descOpen ? '收起' : '展开' }}</span>
          </div>
        </div>
        <button class="btn ghost" :class="{ on: isAlbumFav(favTarget) }" :disabled="!favTarget.id" @click="toggleFavAlbum(favTarget)">
          <Icon name="heart" :size="15" /> {{ isAlbumFav(favTarget) ? '已收藏' : '收藏专辑' }}
        </button>
        <button class="btn primary" :disabled="!songs.length" @click="playAll">
          <Icon name="play" :size="15" /> 播放全部
        </button>
      </div>

      <div v-if="error" class="sv-error">{{ error }}</div>

      <template v-if="songs.length">
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
      </template>
      <div v-else class="center-msg">
        <div>
          <div class="big"><Icon name="playlist" :size="46" /></div>
          <div>该专辑暂无歌曲</div>
        </div>
      </div>
    </template>
  </div>
</template>
