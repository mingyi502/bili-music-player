<script setup>
/**
 * `.rk-row` 页面的行内操作（榜单 / 日推 / FM / 歌手 / 专辑）。
 *
 * 与 SongRow 的移动端约定一致：
 * - 桌面端：播放 / 下一首（保持原有）+ 「更多」；
 * - 移动端：喜欢 / 下载（仅 App）/ 「更多」，次要操作进 ActionSheet。
 */
import { computed } from 'vue'
import Icon from './Icon.vue'
import {
  songKey,
  state,
  playNext,
  matchSong,
  openPlaylistPicker,
  favOf,
  favPending,
  toggleFav,
  hasDownloads,
  isDownloaded,
  isDownloading,
  downloadOf,
  downloadSong,
  removeDownload,
  openActionSheet,
} from '../store/index'

const props = defineProps({ song: { type: Object, required: true } })
const emit = defineEmits(['play'])

const match = computed(() => state.matches[songKey(props.song)])
const favOn = computed(() => favOf(props.song))
const canDownload = computed(() => hasDownloads())
const downloaded = computed(() => isDownloaded(props.song))
const downloading = computed(() => isDownloading(props.song))
const downloadProgress = computed(() => Math.round((downloadOf(props.song)?.progress || 0) * 100))

async function onDownload() {
  if (downloading.value) return
  if (downloaded.value) await removeDownload(props.song)
  else await downloadSong(props.song)
}

function onMore() {
  const items = [
    { icon: 'refresh', label: '重新匹配', onClick: () => matchSong(props.song) },
    { icon: 'playlistAdd', label: '加入歌单', onClick: () => openPlaylistPicker([props.song]) },
    { icon: 'plus', label: '下一首播放', onClick: () => playNext(props.song) },
  ]
  if (match.value?.status === 'ok' && match.value.url) {
    items.push({
      icon: 'video',
      label: '打开 B 站视频',
      hint: match.value.duration || '',
      onClick: () => window.open(match.value.url, '_blank', 'noopener'),
    })
  }
  openActionSheet({ title: props.song.name, items })
}
</script>

<template>
  <div class="s-actions" @click.stop>
    <button class="icon-btn rk-key" title="播放" @click="emit('play')"><Icon name="play" :size="15" /></button>
    <button class="icon-btn rk-key" title="下一首播放" @click="playNext(song)"><Icon name="plus" :size="15" /></button>
    <button
      class="icon-btn rk-extra fav-btn"
      :class="{ on: favOn }"
      :disabled="favPending(song)"
      :title="favOn ? '取消喜欢' : '喜欢'"
      @click="toggleFav(song)"
    >
      <Icon name="heart" :size="15" />
    </button>
    <button
      v-if="canDownload"
      class="icon-btn rk-extra"
      :title="downloaded ? '已下载（点击删除）' : downloading ? `下载中 ${downloadProgress}%` : '下载到本机'"
      @click="onDownload"
    >
      <Icon :name="downloaded ? 'check' : downloading ? 'refresh' : 'download'" :size="15" :class="{ spin: downloading }" />
    </button>
    <button class="icon-btn" title="更多操作" @click="onMore"><Icon name="more" :size="16" /></button>
    <slot />
  </div>
</template>
