<script setup>
import { computed, onMounted, ref } from 'vue'
import Icon from '../components/Icon.vue'
import AppImage from '../components/AppImage.vue'
import TrackActions from '../components/TrackActions.vue'
import { fetchRankList, fetchRankDetail } from '../api/qq/rank.js'
import { state, playLocalQueue } from '../store/index'

const PAGE = 50
/** 默认打开的榜单（热歌榜） */
const DEFAULT_TOP_ID = 26

const groups = ref([])
const activeGroup = ref(0)
const activeId = ref(0)
const info = ref(null)
const songs = ref([])
const offset = ref(0)
const hasMore = ref(false)
const loading = ref(false)
const loadingMore = ref(false)
const error = ref('')

const currentLists = computed(() => groups.value[activeGroup.value]?.lists || [])

async function openRank(id) {
  activeId.value = id
  offset.value = 0
  songs.value = []
  info.value = null
  hasMore.value = false
  loading.value = true
  error.value = ''
  try {
    const res = await fetchRankDetail(id, { offset: 0, num: PAGE, cookie: state.config.qqCookie, uin: state.config.uin })
    info.value = res.info
    songs.value = res.list
    offset.value = res.list.length
    hasMore.value = res.hasMore
  } catch (e) {
    error.value = e.message || '榜单加载失败'
  } finally {
    loading.value = false
  }
}

async function loadList() {
  loading.value = true
  error.value = ''
  try {
    groups.value = await fetchRankList({ cookie: state.config.qqCookie, uin: state.config.uin })
    const all = groups.value.flatMap((g) => g.lists)
    const preferred = all.find((l) => l.id === DEFAULT_TOP_ID) || all[0]
    if (preferred) {
      const gi = groups.value.findIndex((g) => g.lists.includes(preferred))
      activeGroup.value = gi >= 0 ? gi : 0
      await openRank(preferred.id)
      return
    }
    error.value = '榜单列表为空'
  } catch (e) {
    error.value = e.message || '榜单加载失败'
  } finally {
    loading.value = false
  }
}

async function loadMore() {
  if (loadingMore.value || !hasMore.value || !info.value) return
  loadingMore.value = true
  try {
    const res = await fetchRankDetail(activeId.value, {
      offset: offset.value,
      num: PAGE,
      period: info.value.period || '',
      cookie: state.config.qqCookie,
      uin: state.config.uin,
    })
    songs.value = songs.value.concat(res.list)
    offset.value += res.list.length
    hasMore.value = res.hasMore
  } catch (e) {
    error.value = e.message || '加载更多失败'
  } finally {
    loadingMore.value = false
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

function fmtListen(n) {
  const v = Number(n) || 0
  if (v >= 1e8) return `${(v / 1e8).toFixed(1)} 亿`
  if (v >= 1e4) return `${(v / 1e4).toFixed(1)} 万`
  return String(v)
}

onMounted(loadList)
</script>

<template>
  <div class="rank-view">
    <div v-if="loading && !songs.length" class="center-msg">
      <div>
        <span class="spin"><Icon name="refresh" :size="30" /></span>
        <div style="margin-top: 10px">正在加载榜单…</div>
      </div>
    </div>

    <div v-else-if="error && !groups.length" class="sv-error">{{ error }}</div>

    <template v-else>
      <div class="rk-groups">
        <button
          v-for="(g, i) in groups"
          :key="g.name"
          class="rk-group"
          :class="{ on: i === activeGroup }"
          @click="activeGroup = i"
        >
          {{ g.name }}
        </button>
      </div>

      <div class="rk-cards">
        <button
          v-for="l in currentLists"
          :key="l.id"
          class="rk-card"
          :class="{ on: l.id === activeId }"
          @click="openRank(l.id)"
        >
          <AppImage :src="l.cover" alt="" placeholder />
          <div class="rk-card-text">
            <div class="rk-card-name">{{ l.title }}</div>
            <div class="rk-card-sub">{{ l.updateTime || l.period }}</div>
          </div>
        </button>
      </div>

      <div v-if="info" class="rk-head">
        <AppImage class="rk-cover" :src="info.cover" alt="" placeholder />
        <div class="rk-info">
          <div class="rk-title">{{ info.title }}</div>
          <div class="rk-sub">
            {{ info.updateTime }} 更新 · 共 {{ info.total }} 首 · 播放 {{ fmtListen(info.listenNum) }}
          </div>
        </div>
        <button class="btn primary" @click="playAll"><Icon name="play" :size="15" /> 播放全部</button>
      </div>

      <div v-if="error" class="sv-error">{{ error }}</div>

      <div v-if="loading" class="center-msg" style="padding: 40px 0">
        <div>
          <span class="spin"><Icon name="refresh" :size="26" /></span>
          <div style="margin-top: 8px">正在加载榜单…</div>
        </div>
      </div>

      <template v-else-if="songs.length">
        <div v-for="(s, i) in songs" :key="s.mid || s.id || i" class="rk-row" @click="playAt(i)">
          <div class="rk-rank" :class="{ top3: s.rank <= 3 }">{{ s.rank }}</div>
          <AppImage class="s-cover" :src="s.cover" alt="" placeholder />
          <div class="s-main">
            <div class="s-name">
              {{ s.name }}
              <!-- 只展示含义明确的值（如飙升榜 "15%"）；裸数字是排名变动，语义未验证不显示 -->
              <span v-if="s.rankValue && !/^\d+$/.test(s.rankValue)" class="rk-delta">{{ s.rankValue }}</span>
            </div>
            <div class="s-sub">{{ s.singers.join(' / ') || '未知歌手' }}</div>
          </div>
          <div class="s-album" :title="s.album">{{ s.album || '—' }}</div>
          <div class="s-time">{{ fmtDuration(s.interval) }}</div>
          <TrackActions :song="s" @play="playAt(i)" />
        </div>
        <div class="sv-more">
          <button v-if="hasMore" class="btn ghost" :disabled="loadingMore" @click="loadMore">
            <Icon :name="loadingMore ? 'refresh' : 'chevronDown'" :size="14" :class="{ spin: loadingMore }" />
            {{ loadingMore ? '加载中…' : '加载更多' }}
          </button>
          <span v-else class="sv-hint">已加载 {{ songs.length }} / {{ info?.total }}</span>
        </div>
      </template>

      <div v-else class="center-msg">
        <div>
          <div class="big"><Icon name="target" :size="46" /></div>
          <div>该榜单暂无歌曲</div>
        </div>
      </div>
    </template>
  </div>
</template>
