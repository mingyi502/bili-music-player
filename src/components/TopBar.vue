<script setup>
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { state, matchAll, store, toggleSidebar } from '../store/index'
import Icon from './Icon.vue'

const emit = defineEmits(['open-settings'])
const route = useRoute()
const router = useRouter()

/** 顶栏的「歌单内筛选 + 已匹配 + 一键匹配」只在歌单页有意义，其它页面隐藏避免语境不符 */
const onPlaylistPage = computed(() => route.path === '/')

/** 进入搜索页：歌单页带上当前筛选词，其它页面直接进搜索 */
function goSearch() {
  const q = onPlaylistPage.value ? state.filter.trim() : ''
  router.push(q ? { path: '/search', query: { q } } : '/search')
}
</script>

<template>
  <header class="topbar">
    <button class="icon-btn menu-btn" title="歌单" @click="toggleSidebar">
      <Icon name="playlist" :size="20" />
    </button>
    <template v-if="onPlaylistPage">
      <div class="search">
        <input
          v-model="state.filter"
          class="input"
          placeholder="在当前歌单中筛选歌曲 / 歌手"
        />
      </div>
      <div class="spacer"></div>
      <span class="badge matched-badge" :class="store.matchedCount.value ? 'ok' : 'none'">
        已匹配 {{ store.matchedCount.value }} / {{ state.songs.length }}
      </span>
      <button
        class="btn bili sm"
        :disabled="state.loading.matching || !state.songs.length"
        :title="state.loading.matching ? '匹配进行中…' : '只匹配尚未匹配的歌曲（已匹配的会跳过）'"
        @click="matchAll()"
      >
        <Icon
          :name="state.loading.matching ? 'refresh' : 'wand'"
          :size="14"
          :class="{ spin: state.loading.matching }"
        />
        <span class="match-label-full">
          {{ state.loading.matching ? `匹配中 ${state.loading.matchDone}/${state.loading.matchTotal}` : '一键匹配' }}
        </span>
        <span class="match-label-short">
          {{ state.loading.matching ? `${state.loading.matchDone}/${state.loading.matchTotal}` : '匹配' }}
        </span>
      </button>
    </template>
    <div v-else class="spacer"></div>
    <button class="icon-btn" title="搜索 QQ 音乐" @click="goSearch">
      <Icon name="search" :size="18" />
    </button>
    <button class="icon-btn" title="设置" @click="emit('open-settings')">
      <Icon name="settings" :size="18" />
    </button>
  </header>
</template>
