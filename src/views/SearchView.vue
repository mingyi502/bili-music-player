<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Icon from '../components/Icon.vue'
import AppImage from '../components/AppImage.vue'
import { searchByType, fetchHotKeys, fetchSuggest } from '../api/qq/search.js'
import { state, playLocalQueue, playNext, loadAlbum, loadPlaylist, addSearchHistory, clearSearchHistory, removeSearchHistory } from '../store/index'

const route = useRoute()
const router = useRouter()

const TABS = [
  { key: 'song', label: '单曲' },
  { key: 'album', label: '专辑' },
  { key: 'playlist', label: '歌单' },
  { key: 'singer', label: '歌手' },
]

const TYPE_LABEL = { song: '单曲', singer: '歌手', album: '专辑', mv: 'MV' }

const keyword = ref(String(route.query.q || ''))
const tab = ref('song')
const data = reactive({ song: [], album: [], playlist: [], singer: [] })
const totals = reactive({ song: 0, album: 0, playlist: 0, singer: 0 })
const pages = reactive({ song: 1, album: 1, playlist: 1, singer: 1 })
const hasMore = reactive({ song: false, album: false, playlist: false, singer: false })
const loading = ref(false)
const loadingMore = ref(false)
const error = ref('')
const hotAll = ref([])
const hotOffset = ref(0)
const HOT_WINDOW = 12
/** 热搜窗口：接口取 30 条，视图按 12 条循环轮换（「换一换」不发新请求） */
const hot = computed(() => {
  const all = hotAll.value
  if (all.length <= HOT_WINDOW) return all.map((h, i) => ({ ...h, rank: i + 1 }))
  const out = []
  for (let i = 0; i < HOT_WINDOW; i++) {
    const idx = (hotOffset.value + i) % all.length
    out.push({ ...all[idx], rank: idx + 1 })
  }
  return out
})
function refreshHot() {
  const n = hotAll.value.length
  if (n <= HOT_WINDOW) return
  hotOffset.value = (hotOffset.value + HOT_WINDOW) % n
}
const suggestions = ref([])
const sugOpen = ref(false)
const sugIndex = ref(-1)
const sugCache = new Map()
let sugTimer = null

const history = computed(() => state.searchHistory)
const list = computed(() => data[tab.value] || [])
const currentTotal = computed(() => totals[tab.value] || 0)
const showMore = computed(() => hasMore[tab.value])
/** 是否已发起过搜索（用于「历史/热搜」空态判断） */
const searched = computed(() => TABS.some((t) => data[t.key].length || totals[t.key]))

/** 热搜榜（失败静默：不影响搜索主流程；取 30 条供「换一换」轮换） */
async function loadHot() {
  try {
    hotAll.value = await fetchHotKeys({ cookie: state.config.qqCookie, uin: state.config.uin, limit: 30 })
  } catch {
    hotAll.value = []
  }
}

/** 输入联想：250ms 防抖 + 按关键词缓存 */
function onInput() {
  sugIndex.value = -1
  const kw = keyword.value.trim()
  if (!kw) {
    suggestions.value = []
    sugOpen.value = false
    return
  }
  clearTimeout(sugTimer)
  sugTimer = setTimeout(async () => {
    if (sugCache.has(kw)) {
      suggestions.value = sugCache.get(kw)
      sugOpen.value = suggestions.value.length > 0
      return
    }
    try {
      const list = await fetchSuggest(kw, { cookie: state.config.qqCookie })
      if (sugCache.size > 30) sugCache.clear()
      sugCache.set(kw, list)
      if (keyword.value.trim() !== kw) return
      suggestions.value = list
      sugOpen.value = list.length > 0
    } catch {
      if (keyword.value.trim() === kw) {
        suggestions.value = []
        sugOpen.value = false
      }
    }
  }, 250)
}

function closeSuggest() {
  sugOpen.value = false
  sugIndex.value = -1
}

function pickSuggestion(sg) {
  closeSuggest()
  keyword.value = sg.name
  tab.value = 'song'
  runSearch()
}

function onKeydown(e) {
  const open = sugOpen.value && suggestions.value.length > 0
  if (open && e.key === 'ArrowDown') {
    sugIndex.value = (sugIndex.value + 1) % suggestions.value.length
    e.preventDefault()
    return
  }
  if (open && e.key === 'ArrowUp') {
    sugIndex.value = (sugIndex.value - 1 + suggestions.value.length) % suggestions.value.length
    e.preventDefault()
    return
  }
  if (e.key === 'Escape') {
    closeSuggest()
    return
  }
  if (e.key === 'Enter') {
    e.preventDefault()
    if (open && sugIndex.value >= 0) pickSuggestion(suggestions.value[sugIndex.value])
    else {
      closeSuggest()
      runSearch()
    }
  }
}

async function runSearch({ append = false } = {}) {
  const kw = keyword.value.trim()
  if (!kw) return
  closeSuggest()
  const t = tab.value
  if (append) loadingMore.value = true
  else {
    loading.value = true
    error.value = ''
    pages[t] = 1
  }
  try {
    const res = await searchByType(kw, t, {
      page: append ? pages[t] + 1 : 1,
      cookie: state.config.qqCookie,
      uin: state.config.uin,
    })
    if (append) {
      data[t] = data[t].concat(res.list)
      pages[t] += 1
    } else {
      data[t] = res.list
      pages[t] = 1
    }
    totals[t] = res.total
    hasMore[t] = res.hasMore
    if (!append) addSearchHistory(kw)
  } catch (e) {
    error.value = e.message || '搜索失败'
    if (!append) {
      data[t] = []
      totals[t] = 0
      hasMore[t] = false
    }
  } finally {
    loading.value = false
    loadingMore.value = false
  }
}

function pickKeyword(kw) {
  keyword.value = kw
  tab.value = 'song'
  runSearch()
}

function switchTab(key) {
  tab.value = key
  if (!data[key].length && !loading.value && keyword.value.trim()) runSearch()
}

function playSong(index) {
  playLocalQueue(data.song, index)
}

function onPlayNext(song, e) {
  e?.stopPropagation?.()
  playNext(song)
}

async function openAlbum(album) {
  const mid = album.mid || album.id
  if (mid) return router.push(`/album/${mid}`)
  try {
    await loadAlbum(album)
    router.push('/')
  } catch {
    /* toast 已提示 */
  }
}

async function openPlaylist(pl) {
  try {
    await loadPlaylist(pl.id)
    router.push('/')
  } catch {
    /* toast 已提示 */
  }
}

function openSinger(singer) {
  if (singer.mid) router.push(`/artist/${singer.mid}`)
  else pickKeyword(singer.name)
}

function fmtDuration(sec) {
  if (!sec || !isFinite(sec)) return ''
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

watch(
  () => route.query.q,
  (q) => {
    const next = String(q || '')
    if (next && next !== keyword.value) {
      keyword.value = next
      tab.value = 'song'
      runSearch()
    }
  }
)

onMounted(loadHot)
onBeforeUnmount(() => clearTimeout(sugTimer))

if (keyword.value.trim()) runSearch()
</script>

<template>
  <div class="search-view">
    <div class="sv-head">
      <div class="sv-box">
        <Icon name="search" :size="16" />
        <input
          v-model="keyword"
          class="sv-input"
          placeholder="搜索 QQ 音乐：歌曲 / 专辑 / 歌单 / 歌手"
          @input="onInput"
          @keydown="onKeydown"
          @blur="closeSuggest"
        />
        <button v-if="keyword" class="icon-btn" title="清空" @click="keyword = ''">
          <Icon name="close" :size="14" />
        </button>
        <div v-if="sugOpen && suggestions.length" class="sv-sug">
          <button
            v-for="(sg, i) in suggestions"
            :key="sg.type + (sg.mid || sg.name) + i"
            class="sv-sug-item"
            :class="{ on: i === sugIndex }"
            @mousedown.prevent
            @click="pickSuggestion(sg)"
          >
            <span class="sug-type">{{ TYPE_LABEL[sg.type] }}</span>
            <span class="sug-name">{{ sg.name }}</span>
            <span v-if="sg.sub && sg.sub !== sg.name" class="sug-sub">{{ sg.sub }}</span>
          </button>
        </div>
      </div>
      <button class="btn primary sv-go" :disabled="loading || !keyword.trim()" @click="runSearch()">
        <Icon :name="loading ? 'refresh' : 'search'" :size="15" :class="{ spin: loading }" /> 搜索
      </button>
    </div>

    <div class="sv-tabs">
      <button
        v-for="t in TABS"
        :key="t.key"
        class="sv-tab"
        :class="{ on: tab === t.key }"
        @click="switchTab(t.key)"
      >
        {{ t.label }}
        <span v-if="totals[t.key]" class="sv-total">{{ totals[t.key] }}</span>
      </button>
    </div>

    <div v-if="!searched && history.length" class="sv-history">
      <div class="sv-history-head">
        <span>搜索历史</span>
        <button class="btn ghost sm" @click="clearSearchHistory">清空</button>
      </div>
      <div class="sv-chips">
        <div v-for="kw in history" :key="kw" class="sv-chip sv-chip-del">
          <button class="sv-chip-text" @click="pickKeyword(kw)">{{ kw }}</button>
          <button class="sv-chip-x" title="删除这条历史" @click.stop="removeSearchHistory(kw)">
            <Icon name="close" :size="10" />
          </button>
        </div>
      </div>
    </div>

    <div v-if="!searched && hot.length" class="sv-hot">
      <div class="sv-history-head">
        <span>热搜榜</span>
        <button class="btn ghost sm" title="换一批热词" @click="refreshHot">
          <Icon name="refresh" :size="13" /> 换一换
        </button>
      </div>
      <div class="sv-chips">
        <button
          v-for="h in hot"
          :key="h.keyword"
          class="sv-chip sv-hot-chip"
          :class="{ top: h.rank <= 3 }"
          :title="h.description"
          @click="pickKeyword(h.keyword)"
        >
          <span class="sv-rank">{{ h.rank }}</span>{{ h.keyword }}
        </button>
      </div>
    </div>

    <div v-if="!searched && !history.length" class="center-msg">
      <div>
        <div class="big"><Icon name="search" :size="52" /></div>
        <div>搜索 QQ 音乐曲库</div>
        <div style="margin-top: 6px">支持歌曲 / 专辑 / 歌单 / 歌手；点歌后按 B 站匹配策略播放</div>
      </div>
    </div>

    <div v-if="error" class="sv-error">{{ error }}</div>
    <div v-if="loading" class="center-msg">
      <div>
        <span class="spin"><Icon name="refresh" :size="30" /></span>
        <div style="margin-top: 10px">正在搜索…</div>
      </div>
    </div>

    <template v-else-if="list.length">
      <!-- 单曲 -->
      <template v-if="tab === 'song'">
        <div v-for="(song, i) in list" :key="song.mid || song.id || i" class="sv-row" @click="playSong(i)">
          <AppImage class="s-cover" :src="song.cover" alt="" placeholder />
          <div class="s-main">
            <div class="s-name" :data-vip="song.payplay ? '1' : null" :title="song.payplay ? 'QQ 音乐 VIP / 付费歌曲：无直链时自动回退 B 站音源' : null">{{ song.name }}</div>
            <div class="s-sub">{{ song.singers.join(' / ') || '未知歌手' }}</div>
          </div>
          <div class="s-album" :title="song.album">{{ song.album || '—' }}</div>
          <div class="s-time">{{ fmtDuration(song.interval) }}</div>
          <div class="s-actions" @click.stop>
            <button class="icon-btn" title="播放" @click="playSong(i)"><Icon name="play" :size="15" /></button>
            <button class="icon-btn" title="下一首播放" @click="onPlayNext(song, $event)"><Icon name="plus" :size="15" /></button>
          </div>
        </div>
      </template>

      <!-- 专辑 -->
      <template v-else-if="tab === 'album'">
        <div v-for="(al, i) in list" :key="al.mid || al.id || i" class="sv-row" @click="openAlbum(al)">
          <AppImage class="s-cover" :src="al.cover" alt="" placeholder />
          <div class="s-main">
            <div class="s-name">{{ al.name }}</div>
            <div class="s-sub">{{ al.singers.join(' / ') || '未知歌手' }}</div>
          </div>
          <div class="s-album">{{ al.songCount }} 首</div>
          <div class="s-time">{{ al.pubtime || '' }}</div>
          <div class="s-actions" @click.stop>
            <button class="icon-btn" title="打开专辑" @click="openAlbum(al)"><Icon name="external" :size="15" /></button>
          </div>
        </div>
      </template>

      <!-- 歌单 -->
      <template v-else-if="tab === 'playlist'">
        <div v-for="(pl, i) in list" :key="pl.id || i" class="sv-row" @click="openPlaylist(pl)">
          <AppImage class="s-cover" :src="pl.cover" alt="" placeholder />
          <div class="s-main">
            <div class="s-name">{{ pl.name }}</div>
            <div class="s-sub">{{ pl.nick || 'QQ音乐用户' }} · {{ pl.songCount }} 首</div>
          </div>
          <div class="s-album">播放 {{ pl.listenNum || 0 }}</div>
          <div class="s-time"></div>
          <div class="s-actions" @click.stop>
            <button class="icon-btn" title="打开歌单" @click="openPlaylist(pl)"><Icon name="external" :size="15" /></button>
          </div>
        </div>
      </template>

      <!-- 歌手 -->
      <template v-else>
        <div v-for="(sg, i) in list" :key="sg.mid || sg.id || i" class="sv-row" @click="openSinger(sg)">
          <AppImage class="s-cover round" :src="sg.cover" alt="" placeholder />
          <div class="s-main">
            <div class="s-name">{{ sg.name }}</div>
            <div class="s-sub">{{ sg.songCount ? sg.songCount + ' 首相关单曲' : '歌手' }} · 点击搜索该歌手</div>
          </div>
          <div class="s-album"></div>
          <div class="s-time"></div>
          <div class="s-actions" @click.stop>
            <button class="icon-btn" title="搜索该歌手" @click="openSinger(sg)"><Icon name="search" :size="15" /></button>
          </div>
        </div>
      </template>

      <div class="sv-more">
        <button v-if="showMore" class="btn ghost" :disabled="loadingMore" @click="runSearch({ append: true })">
          <Icon :name="loadingMore ? 'refresh' : 'chevronDown'" :size="14" :class="{ spin: loadingMore }" />
          {{ loadingMore ? '加载中…' : '加载更多' }}
        </button>
        <span v-if="!showMore && currentTotal > list.length" class="sv-hint">已加载 {{ list.length }} / {{ currentTotal }}</span>
      </div>
    </template>

    <div v-else-if="searched && !loading" class="center-msg">
      <div>
        <div class="big"><Icon name="music" :size="46" /></div>
        <div>没有找到「{{ keyword }}」相关的结果</div>
      </div>
    </div>
  </div>
</template>
