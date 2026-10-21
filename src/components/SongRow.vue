<script setup>
import { computed } from 'vue'
import Icon from './Icon.vue'
import AppImage from './AppImage.vue'
import { songKey, playIndex, togglePlay, matchSong, openCandidateDialog, playNext, addToQueue, state, favOf, favPending, toggleFav, openPlaylistPicker, currentCreatedPlaylist, removeSongFromPlaylist, hasDownloads, isDownloaded, isDownloading, downloadOf, downloadSong, removeDownload, openActionSheet } from '../store/index'

const props = defineProps({
  song: { type: Object, required: true },
  index: { type: Number, required: true },
  /** 选择模式（歌单批量选择）：整行点击 = 勾选/取消，隐藏播放键与行内操作 */
  selectable: { type: Boolean, default: false },
  selected: { type: Boolean, default: false },
})
const emit = defineEmits(['toggle-select'])

/** 当前歌单若为「创建的歌单」→ 提供「从歌单移除」 */
const owner = computed(() => currentCreatedPlaylist())

/** 下载状态（P6，仅 App 显示入口） */
const canDownload = computed(() => hasDownloads())
const downloaded = computed(() => isDownloaded(props.song))
const downloading = computed(() => isDownloading(props.song))
const downloadProgress = computed(() => Math.round((downloadOf(props.song)?.progress || 0) * 100))
const downloadTitle = computed(() =>
  downloaded.value ? '已下载（点击删除）' : downloading.value ? `下载中 ${downloadProgress.value}%` : '下载到本机'
)
async function onDownload() {
  if (downloading.value) return
  if (downloaded.value) await removeDownload(props.song)
  else await downloadSong(props.song)
}

/** 移动端「更多」：次要操作收进底部动作面板，避免行内拥挤 */
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
  if (owner.value) {
    items.push({ icon: 'trash', label: '从歌单移除', danger: true, onClick: () => removeSongFromPlaylist(owner.value, props.song) })
  }
  openActionSheet({ title: props.song.name, items })
}

const match = computed(() => state.matches[songKey(props.song)])
const isActive = computed(() => state.player.index === props.index)
const isPlaying = computed(() => isActive.value && state.player.playing)
const matching = computed(() => match.value?.status === 'loading')
// 行内封面：QQ 侧没有封面时（647 首里实测有 8 首）回退到匹配到的 B站封面，
// 否则整行只剩灰块（播放条一直有回退，所以会出现「行内空白、播放条有图」）
const rowCover = computed(
  () => props.song.cover || (match.value?.status === 'ok' ? match.value.cover || '' : ''),
)
// 桌面端右侧还有「匹配区」会显示同一张 B站封面 → 这种回退情况下行内小图就不再重复显示
// （移动端没有匹配区，CSS 里会把它放回来）
const coverFromMatch = computed(() => !props.song.cover && !!rowCover.value)

/** 当前行在播放 → 暂停；否则切到该行播放 */
function onRowPlay() {
  if (isActive.value) togglePlay()
  else playIndex(props.index)
}

/** 点整行即可播放（B站按钮等操作区已阻止冒泡，不会误触）；选择模式下改为勾选 */
function onRowClick() {
  if (props.selectable) {
    emit('toggle-select')
    return
  }
  onRowPlay()
}

function fmtNum(n) {
  if (!n) return '0'
  if (n >= 100000000) return (n / 100000000).toFixed(1) + '亿'
  if (n >= 10000) return (n / 10000).toFixed(1) + '万'
  return String(n)
}
</script>

<template>
  <div class="song-row" :class="{ active: isActive, 'select-mode': selectable, selected }" @click="onRowClick">
    <div class="idx">
      <span v-if="selectable" class="pick" :class="{ on: selected }">
        <Icon v-if="selected" name="check" :size="12" />
      </span>
      <template v-else>
        <span class="num">
          <span v-if="isPlaying" class="row-eq" aria-hidden="true" title="正在播放">
            <i></i><i></i><i></i>
          </span>
          <template v-else>{{ index + 1 }}</template>
        </span>
        <button class="play-mini" :title="isPlaying ? '暂停' : '播放'" @click.stop="onRowPlay">
          <Icon :name="isPlaying ? 'pause' : 'play'" :size="15" />
        </button>
      </template>
    </div>

    <div class="track" :class="{ 'cover-from-match': coverFromMatch }">
      <AppImage :src="rowCover" alt="" placeholder />
      <div style="min-width: 0">
        <div class="t-name" :data-vip="song.payplay ? '1' : null" :title="song.payplay ? 'QQ 音乐 VIP / 付费歌曲：无直链时自动回退 B 站音源' : null">{{ song.name }}</div>
        <div class="t-singer">{{ song.singers.join(' / ') || '未知歌手' }}</div>
        <div v-if="match && match.status === 'ok'" class="t-match" :title="match.title">
          {{ match.title }}
        </div>
      </div>
    </div>

    <div class="match-cell col-match">
      <template v-if="match && match.status === 'ok'">
        <AppImage :src="match.cover" alt="" />
        <div class="m-text">
          <div class="m-title">{{ match.title }}</div>
          <div class="m-sub">{{ match.author }} · {{ fmtNum(match.play) }} 播放 · {{ match.duration }}</div>
        </div>
      </template>
      <template v-else-if="match && match.status === 'loading'">
        <span class="badge loading"><Icon name="refresh" :size="12" class="spin" /> 匹配中…</span>
      </template>
      <template v-else-if="match && match.status === 'error'">
        <span class="badge err">{{ match.error }}</span>
      </template>
      <template v-else>
        <span class="badge none">未匹配</span>
      </template>
    </div>

    <div class="status-cell">
      <span v-if="match && match.status === 'ok'" class="badge" :class="match.manual ? 'manual' : 'ok'">
        {{ match.manual ? '手动' : '自动' }}
      </span>
      <button
        v-if="match && match.status === 'ok' && match.confidence && match.confidence !== 'high'"
        class="badge warn"
        :title="`自动匹配可信度${match.confidence === 'medium' ? '一般' : '较低'}${match.score != null ? `（${Math.round(match.score)} 分）` : ''}：点击重新选择`"
        @click.stop="openCandidateDialog(song)"
      >
        存疑
      </button>
      <span v-if="match && match.status === 'loading'" class="badge loading">…</span>
      <span v-else-if="match && match.status === 'error'" class="badge err">!</span>
      <span v-else-if="!match || match.status === 'none'" class="badge none">—</span>
    </div>

    <div v-if="!selectable" class="row-actions" @click.stop>
      <!-- 移动端常显：红心 + 下载（可用时）+ 更多（次要操作收进底部面板） -->
      <button
        class="icon-btn mobile-only fav-btn"
        :class="{ on: favOf(song) }"
        :disabled="favPending(song)"
        :title="favOf(song) ? '取消喜欢' : '喜欢'"
        @click.stop="toggleFav(song)"
      >
        <Icon name="heart" :size="15" />
      </button>
      <button
        v-if="canDownload"
        class="icon-btn mobile-only fav-btn"
        :class="{ on: downloaded }"
        :disabled="downloading"
        :title="downloadTitle"
        @click.stop="onDownload"
      >
        <Icon :name="downloaded ? 'check' : downloading ? 'refresh' : 'download'" :size="15" :class="{ spin: downloading }" />
      </button>
      <button class="icon-btn mobile-only" title="更多操作" @click.stop="onMore">
        <Icon name="more" :size="16" />
      </button>
      <button class="icon-btn hover-only fav-btn" :class="{ on: favOf(song) }" :disabled="favPending(song)" :title="favOf(song) ? '取消喜欢' : '喜欢'" @click.stop="toggleFav(song)">
        <Icon name="heart" :size="15" />
      </button>
      <button class="icon-btn hover-only" title="重新匹配" @click.stop="matchSong(song)">
        <Icon name="refresh" :size="15" />
      </button>
      <button class="icon-btn hover-only" title="搜索并选择" @click.stop="openCandidateDialog(song)">
        <Icon name="search" :size="15" />
      </button>
      <button class="icon-btn hover-only" title="下一首播放" @click.stop="playNext(song)">
        <Icon name="plus" :size="15" />
      </button>
      <button class="icon-btn hover-only" title="加入播放队列" @click.stop="addToQueue(song)">
        <Icon name="playlist" :size="15" />
      </button>
      <button class="icon-btn hover-only" title="加入歌单" @click.stop="openPlaylistPicker([song])">
        <Icon name="playlistAdd" :size="15" />
      </button>
      <button
        v-if="canDownload"
        class="icon-btn hover-only fav-btn"
        :class="{ on: downloaded }"
        :disabled="downloading"
        :title="downloadTitle"
        @click.stop="onDownload"
      >
        <Icon :name="downloaded ? 'check' : downloading ? 'refresh' : 'download'" :size="15" :class="{ spin: downloading }" />
      </button>
      <button v-if="owner" class="icon-btn hover-only" title="从歌单移除" @click.stop="removeSongFromPlaylist(owner, song)">
        <Icon name="trash" :size="15" />
      </button>
      <a
        v-if="match && match.status === 'ok'"
        class="icon-btn bili-link mobile-hide"
        :href="match.url"
        target="_blank"
        rel="noreferrer"
        title="打开 B 站视频"
        @click.stop
      >
        <Icon name="video" :size="15" />
        <span class="bili-text">B站</span>
      </a>
    </div>
  </div>
</template>
