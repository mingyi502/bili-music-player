<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import Icon from '../components/Icon.vue'
import AppImage from '../components/AppImage.vue'
import {
  fetchSquareTags,
  fetchSquareList,
  ALL_CATEGORY_ID,
  DEFAULT_SORT_ID,
  FALLBACK_SORTS,
} from '../api/qq/square.js'
import { state, loadPlaylist } from '../store/index'

const PAGE = 30

const router = useRouter()
const groups = ref([])
const activeGroup = ref(0)
const activeCategory = ref(ALL_CATEGORY_ID)
const activeSort = ref(DEFAULT_SORT_ID)
const list = ref([])
const page = ref(1)
const total = ref(0)
const hasMore = ref(false)
const loading = ref(false)
const loadingMore = ref(false)
const error = ref('')

const currentTags = computed(() => groups.value[activeGroup.value]?.tags || [])

const sortOptions = computed(() => {
  for (const g of groups.value) {
    for (const t of g.tags) {
      if (t.id === activeCategory.value && t.sorts.length) return t.sorts
    }
  }
  return FALLBACK_SORTS
})

function fmtListen(n) {
  const v = Number(n) || 0
  if (v >= 1e8) return `${(v / 1e8).toFixed(1)} 亿`
  if (v >= 1e4) return `${(v / 1e4).toFixed(1)} 万`
  return String(v)
}

async function loadList({ append = false } = {}) {
  if (append) loadingMore.value = true
  else {
    loading.value = true
    error.value = ''
    page.value = 1
  }
  try {
    const res = await fetchSquareList({
      categoryId: activeCategory.value,
      sortId: activeSort.value,
      page: append ? page.value + 1 : 1,
      pageSize: PAGE,
      cookie: state.config.qqCookie,
    })
    if (append) {
      list.value = list.value.concat(res.list)
      page.value += 1
    } else {
      list.value = res.list
      page.value = 1
    }
    total.value = res.total
    hasMore.value = res.hasMore
  } catch (e) {
    error.value = e.message || '歌单广场加载失败'
    if (!append) {
      list.value = []
      total.value = 0
      hasMore.value = false
    }
  } finally {
    loading.value = false
    loadingMore.value = false
  }
}

async function loadTags() {
  loading.value = true
  error.value = ''
  try {
    groups.value = await fetchSquareTags({ cookie: state.config.qqCookie })
    const hot = groups.value[0]
    const first = hot?.tags[0]
    if (first) activeCategory.value = first.id
    await loadList()
  } catch (e) {
    error.value = e.message || '歌单广场加载失败'
    loading.value = false
  }
}

function pickTag(tag) {
  if (activeCategory.value === tag.id) return
  activeCategory.value = tag.id
  const options = tag.sorts.length ? tag.sorts : FALLBACK_SORTS
  if (!options.some((s) => s.id === activeSort.value)) activeSort.value = options[0].id
  loadList()
}

/** 切换分类分组：自动选中该组第一个标签并重新加载（避免标签墙过长） */
function pickGroup(i) {
  activeGroup.value = i
  const first = groups.value[i]?.tags[0]
  if (first) pickTag(first)
}

async function openPlaylist(pl) {
  try {
    await loadPlaylist(pl.id)
    router.push('/')
  } catch {
    /* toast 已提示 */
  }
}

onMounted(loadTags)
</script>

<template>
  <div class="sq-view">
    <div class="sq-head">
      <div class="sq-title"><Icon name="playlist" :size="18" /> 歌单广场</div>
      <div class="sq-sub" v-if="total">{{ total.toLocaleString() }} 个歌单</div>
    </div>

    <div v-if="groups.length" class="sq-filters">
      <div class="sq-groups">
        <button
          v-for="(g, i) in groups"
          :key="g.name"
          class="sq-group"
          :class="{ on: i === activeGroup }"
          @click="pickGroup(i)"
        >
          {{ g.name }}
        </button>
      </div>
      <div class="sq-tag-group">
        <span class="sq-tag-label">分类</span>
        <button
          v-for="t in currentTags"
          :key="t.id"
          class="sq-tag"
          :class="{ on: t.id === activeCategory }"
          @click="pickTag(t)"
        >
          {{ t.name }}
        </button>
      </div>
      <div class="sq-tag-group">
        <span class="sq-tag-label">排序</span>
        <button
          v-for="s in sortOptions"
          :key="s.id"
          class="sq-tag"
          :class="{ on: s.id === activeSort }"
          @click="activeSort !== s.id && ((activeSort = s.id), loadList())"
        >
          {{ s.name }}
        </button>
      </div>
    </div>

    <div v-if="error" class="sv-error">{{ error }}</div>

    <div v-if="loading" class="center-msg">
      <div>
        <span class="spin"><Icon name="refresh" :size="30" /></span>
        <div style="margin-top: 10px">正在加载歌单广场…</div>
      </div>
    </div>

    <template v-else-if="list.length">
      <div class="sq-grid">
        <div v-for="pl in list" :key="pl.id" class="sq-card" @click="openPlaylist(pl)">
          <div class="sq-cover-wrap">
            <AppImage class="sq-cover" :src="pl.cover" alt="" placeholder />
            <span class="sq-play"><Icon name="play" :size="18" /></span>
          </div>
          <div class="sq-name">{{ pl.name }}</div>
          <div class="sq-meta">
            <span>{{ pl.nick || 'QQ音乐' }}</span>
            <span v-if="pl.listenNum">· {{ fmtListen(pl.listenNum) }}</span>
          </div>
        </div>
      </div>
      <div class="sv-more">
        <button v-if="hasMore" class="btn ghost" :disabled="loadingMore" @click="loadList({ append: true })">
          <Icon :name="loadingMore ? 'refresh' : 'chevronDown'" :size="14" :class="{ spin: loadingMore }" />
          {{ loadingMore ? '加载中…' : '加载更多' }}
        </button>
        <span v-else class="sv-hint">已加载 {{ list.length }} / {{ total }}</span>
      </div>
    </template>

    <div v-else-if="!loading" class="center-msg">
      <div>
        <div class="big"><Icon name="playlist" :size="46" /></div>
        <div>该分类暂无歌单</div>
      </div>
    </div>
  </div>
</template>
