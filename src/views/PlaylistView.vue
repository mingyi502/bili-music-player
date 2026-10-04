<script setup>
import { computed, ref, watch } from 'vue'
import Icon from '../components/Icon.vue'
import AppImage from '../components/AppImage.vue'
import SongRow from '../components/SongRow.vue'
import { state, matchAll, clearMatches, playIndex, store, refreshFavStates, openPlaylistPicker, currentCreatedPlaylist, deletePlaylist, removeSongsFromPlaylist, isPlaylistFav, toggleFavPlaylist, hasDownloads, queueDownloads, exportCurrentPlaylist, openActionSheet, openShare } from '../store/index'
import { playlistShareUrl } from '../utils/share.js'

const playlist = computed(() => state.playlist)
const songs = computed(() => state.songs)
const rows = computed(() => {
  const kw = state.filter.trim().toLowerCase()
  return songs.value
    .map((song, index) => ({ song, index }))
    .filter(({ song }) => {
      if (!kw) return true
      return (
        song.name.toLowerCase().includes(kw) ||
        song.singers.join(' ').toLowerCase().includes(kw)
      )
    })
})
const progressText = computed(
  () => `${state.loading.matchDone}/${state.loading.matchTotal}`
)

/** 歌曲列表变化时回显红心状态（P4.1，静默失败） */
watch(
  songs,
  (list) => refreshFavStates(list),
  { immediate: true }
)

/** 当前歌单若为「创建的歌单」→ 显示批量加歌 / 删除入口（P4.6/P4.7） */
const createdOwner = computed(() => currentCreatedPlaylist())
function onDeleteCurrent() {
  if (createdOwner.value) deletePlaylist(createdOwner.value.dirId, createdOwner.value.name)
}

/** 收藏歌单（D3）：非自建歌单显示「收藏 / 取消收藏」 */
const playlistFaved = computed(() => isPlaylistFav(playlist.value))
function onToggleFavPlaylist() {
  if (playlist.value) toggleFavPlaylist(playlist.value)
}

/** 分享歌单（P5 E3）：仅 QQ 数字歌单有外链 */
const shareUrl = computed(() => playlistShareUrl(playlist.value?.id))
function onShare() {
  openShare({
    title: playlist.value?.name || '歌单',
    subtitle: `${songs.value.length} 首歌曲 · 来自 bili-music-player`,
    url: shareUrl.value,
  })
}

/** 导出歌单（G5）：JSON / m3u 菜单 */
const exportMenu = ref(false)
async function onExport(format) {
  exportMenu.value = false
  await exportCurrentPlaylist(format)
}

/** 选择模式（批量：加入歌单 / 下载 / 从创建的歌单移除） */
const selectMode = ref(false)
const selected = ref(new Set())
const selectedSongs = computed(() => songs.value.filter((s) => selected.value.has(s)))
const allSelected = computed(() => rows.value.length > 0 && rows.value.every((r) => selected.value.has(r.song)))
function toggleSelect(song) {
  const next = new Set(selected.value)
  if (next.has(song)) next.delete(song)
  else next.add(song)
  selected.value = next
}
function toggleSelectAll() {
  selected.value = allSelected.value ? new Set() : new Set(rows.value.map((r) => r.song))
}
function exitSelect() {
  selectMode.value = false
  selected.value = new Set()
}
async function onRemoveSelected() {
  if (!createdOwner.value || !selectedSongs.value.length) return
  await removeSongsFromPlaylist(createdOwner.value, selectedSongs.value)
  exitSelect()
}
// 切换歌单/清空视图时退出选择模式
watch(
  () => playlist.value?.id,
  () => exitSelect()
)

/** 移动端「更多」：把次要操作收进底部动作面板（桌面端仍为按钮直出） */
function onMore() {
  const items = [
    { icon: 'check', label: '选择歌曲', onClick: () => (selectMode.value = true) },
    { icon: 'playlistAdd', label: '加入歌单', onClick: () => openPlaylistPicker(songs.value) },
  ]
  if (shareUrl.value) {
    items.push({ icon: 'share', label: '分享歌单', onClick: onShare })
  }
  if (createdOwner.value) {
    items.push({ icon: 'trash', label: '删除歌单', danger: true, onClick: onDeleteCurrent })
  } else {
    items.push({ icon: 'heart', label: playlistFaved.value ? '取消收藏歌单' : '收藏歌单', onClick: onToggleFavPlaylist })
  }
  if (hasDownloads()) {
    items.push({ icon: 'download', label: '下载全部', onClick: () => queueDownloads(songs.value) })
  }
  items.push({ icon: 'external', label: '导出 JSON（可再导入）', onClick: () => onExport('json') })
  items.push({ icon: 'external', label: '导出 m3u（通用播放列表）', onClick: () => onExport('m3u') })
  if (Object.keys(state.matches).length) {
    items.push({ icon: 'refresh', label: '清空匹配缓存', onClick: clearMatches })
  }
  openActionSheet({ title: playlist.value?.name || '歌单操作', items })
}
</script>

<template>
  <div v-if="state.loading.playlist" class="center-msg">
    <div>
      <span class="spin"><Icon name="refresh" :size="34" /></span>
      <div style="margin-top: 12px">正在加载歌单…</div>
    </div>
  </div>

  <!-- 没有歌单时才是初始空态；空歌单仍渲染头部（可播放/加入/删除） -->
  <template v-else-if="playlist">
    <div class="playlist-header">
        <AppImage class="cover" :src="playlist.cover" alt="" />
      <div class="meta">
        <div class="tag">Playlist</div>
        <h1>{{ playlist.name }}</h1>
        <div class="sub">
          <span>{{ playlist.nick || 'QQ音乐用户' }}</span>
          <span>{{ songs.length }} 首歌曲</span>
          <span v-if="playlist.listenNum">播放 {{ playlist.listenNum }}</span>
          <span>已匹配 {{ store.matchedCount.value }} 首</span>
        </div>
        <div v-if="playlist.desc" class="desc">{{ playlist.desc }}</div>
        <div class="header-actions">
          <button class="btn primary" :disabled="state.loading.matching || !songs.length" @click="playIndex(0)">
            <Icon name="play" :size="15" /> 播放全部
          </button>
          <button class="btn bili" :disabled="state.loading.matching || !songs.length" @click="matchAll()">
            <Icon :name="state.loading.matching ? 'refresh' : 'wand'" :size="15" :class="{ spin: state.loading.matching }" />
            {{ state.loading.matching ? `匹配中 ${progressText}` : '一键匹配 B 站' }}
          </button>
          <button class="btn ghost sm hdr-desktop" :disabled="!Object.keys(state.matches).length" @click="clearMatches">
            清空匹配缓存
          </button>
          <button class="btn ghost sm hdr-desktop" :disabled="!songs.length" @click="openPlaylistPicker(songs)">
            <Icon name="playlistAdd" :size="14" /> 加入歌单
          </button>
          <button v-if="createdOwner" class="btn ghost sm hdr-desktop" @click="onDeleteCurrent">
            <Icon name="trash" :size="14" /> 删除歌单
          </button>
          <button v-else class="btn ghost sm hdr-desktop" :class="{ on: playlistFaved }" :disabled="!playlist?.id" @click="onToggleFavPlaylist">
            <Icon name="heart" :size="14" /> {{ playlistFaved ? '取消收藏' : '收藏歌单' }}
          </button>
          <button v-if="hasDownloads()" class="btn ghost sm hdr-desktop" :disabled="!songs.length" @click="queueDownloads(songs)">
            <Icon name="download" :size="14" /> 下载全部
          </button>
          <button class="btn ghost sm hdr-desktop" :disabled="!songs.length" title="批量选择歌曲" @click="selectMode = true">
            <Icon name="check" :size="14" /> 选择
          </button>
          <button class="btn ghost sm hdr-mobile" title="更多操作" @click="onMore">
            <Icon name="more" :size="15" /> 更多
          </button>
          <button v-if="shareUrl" class="btn ghost sm hdr-desktop" @click="onShare">
            <Icon name="share" :size="14" /> 分享
          </button>
          <div class="export-wrap hdr-desktop">
            <button class="btn ghost sm" :disabled="!songs.length" title="导出歌单（JSON / m3u）" @click="exportMenu = !exportMenu">
              <Icon name="external" :size="14" /> 导出
            </button>
            <div v-if="exportMenu" class="export-menu">
              <button class="export-item" @click="onExport('json')">JSON（可再导入）</button>
              <button class="export-item" @click="onExport('m3u')">m3u（通用播放列表）</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-if="songs.length" class="song-head">
      <div style="text-align: center">#</div>
      <div>歌曲</div>
      <div class="col-match">哔哩哔哩视频</div>
      <div>状态</div>
      <div style="text-align: right">操作</div>
    </div>

    <SongRow
      v-for="row in rows"
      :key="row.song.mid || row.song.id || row.index"
      :song="row.song"
      :index="row.index"
      :selectable="selectMode"
      :selected="selected.has(row.song)"
      @toggle-select="toggleSelect(row.song)"
    />

    <div v-if="selectMode" class="select-bar">
      <button class="btn ghost sm" @click="toggleSelectAll">{{ allSelected ? '取消全选' : '全选' }}</button>
      <span class="sel-count">已选 {{ selected.size }} 首</span>
      <div class="sel-actions">
        <button class="btn ghost sm" :disabled="!selected.size" @click="openPlaylistPicker(selectedSongs)">
          <Icon name="playlistAdd" :size="14" /> 加入歌单
        </button>
        <button v-if="hasDownloads()" class="btn ghost sm" :disabled="!selected.size" @click="queueDownloads(selectedSongs)">
          <Icon name="download" :size="14" /> 下载
        </button>
        <button v-if="createdOwner" class="btn danger sm" :disabled="!selected.size" @click="onRemoveSelected">
          <Icon name="trash" :size="14" /> 从歌单移除
        </button>
        <button class="btn primary sm" @click="exitSelect">完成</button>
      </div>
    </div>

    <div v-if="!songs.length" class="center-msg">
      <div>
        <div class="big"><Icon name="music" :size="46" /></div>
        <div>该歌单暂无歌曲{{ createdOwner ? '（可用「加入歌单」从其它歌单批量导入）' : '' }}</div>
      </div>
    </div>
  </template>

  <!-- 初始空态：还没有选择/导入任何歌单 -->
  <div v-else class="center-msg">
    <div>
      <div class="big"><Icon name="music" :size="52" /></div>
      <div>点左上角按钮打开歌单列表，登录后自动导入你的歌单</div>
      <div style="margin-top: 6px">也可以粘贴 QQ 音乐歌单链接 / 歌单 ID 添加</div>
    </div>
  </div>
</template>
