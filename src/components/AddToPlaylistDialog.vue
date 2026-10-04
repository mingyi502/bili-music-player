<script setup>
import Icon from './Icon.vue'
import { state, store, addSongsToPlaylist, closePlaylistPicker, createPlaylist } from '../store/index'

/** 选中已有歌单 → 批量加入 */
async function pick(pl) {
  const songs = state.playlistPicker.songs.slice()
  closePlaylistPicker()
  await addSongsToPlaylist({ dirId: pl.dirId, tid: Number(pl.id) || 0, name: pl.name }, songs)
}

/** 新建歌单并加入（新建走输入弹窗） */
async function createAndAdd() {
  const songs = state.playlistPicker.songs.slice()
  const res = await createPlaylist()
  if (!res?.dirId) return
  closePlaylistPicker()
  await addSongsToPlaylist({ dirId: res.dirId, tid: res.tid, name: res.name || '' }, songs)
}
</script>

<template>
  <div v-if="state.playlistPicker.open" class="overlay" @click.self="closePlaylistPicker">
    <div class="dialog picker-dialog">
      <div class="dialog-head">
        <h3>加入歌单（{{ state.playlistPicker.songs.length }} 首）</h3>
        <button class="icon-btn" title="关闭" @click="closePlaylistPicker"><Icon name="close" :size="16" /></button>
      </div>
      <div class="dialog-body">
        <button class="btn ghost picker-create" @click="createAndAdd">
          <Icon name="plus" :size="14" /> 新建歌单并加入
        </button>
        <div v-if="store.createdPlaylists.value.length" class="picker-list">
          <button v-for="pl in store.createdPlaylists.value" :key="pl.id" class="picker-item" @click="pick(pl)">
            <Icon name="playlist" :size="16" />
            <span class="picker-name">{{ pl.name }}</span>
            <span class="picker-count">{{ pl.songCount }} 首</span>
          </button>
        </div>
        <div v-else class="sd-empty">还没有创建的歌单，点上方「新建歌单并加入」</div>
      </div>
    </div>
  </div>
</template>
