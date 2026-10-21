<script setup>
import { computed } from 'vue'
import Icon from '../components/Icon.vue'
import AppImage from '../components/AppImage.vue'
import { state, playLocalQueue, togglePlay, clearHistory, askConfirm } from '../store/index'

const history = computed(() => state.history)

/** 当前播放项是否来自「本地队列」（最近播放 / 本地列表），避免与主列表播放混淆高亮 */
function currentLocalKey() {
  const entry = state.queue[state.player.queueIndex]
  return entry && entry.from === 'local' ? entry.key : ''
}

function isCurrent(item) {
  return currentLocalKey() === item.key
}
function isPlaying(item) {
  return isCurrent(item) && state.player.playing
}

async function onRow(index) {
  const item = history.value[index]
  if (!item) return
  if (isCurrent(item)) {
    togglePlay()
    return
  }
  // 本地队列播放：不改主列表 / 侧栏状态
  await playLocalQueue(
    history.value.map((h) => h.song),
    index
  )
}

function playAll() {
  if (!history.value.length) return
  playLocalQueue(
    history.value.map((h) => h.song),
    0
  )
}

/** 清空最近播放：走通用二次确认弹窗（P4.0） */
async function onClear() {
  const ok = await askConfirm({
    title: '清空最近播放',
    message: '将删除本机记录的全部最近播放，此操作不可撤销。',
    confirmText: '清空',
    danger: true,
  })
  if (ok) clearHistory()
}

function fmtTime(ts) {
  if (!ts) return ''
  const diff = Date.now() - ts
  if (diff < 60e3) return '刚刚'
  if (diff < 3600e3) return `${Math.floor(diff / 60e3)} 分钟前`
  const d = new Date(ts)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }
  const yest = new Date(now.getTime() - 86400e3)
  if (d.toDateString() === yest.toDateString()) return '昨天'
  return `${d.getMonth() + 1}-${d.getDate()}`
}
</script>

<template>
  <div class="history-view">
    <div class="playlist-header">
      <div class="cover history-cover"><Icon name="clock" :size="44" /></div>
      <div class="meta">
        <div class="tag">History</div>
        <h1>最近播放</h1>
        <div class="sub">
          <span>{{ history.length }} 首</span>
          <span>仅本机记录</span>
        </div>
        <div class="header-actions">
          <button class="btn primary" :disabled="!history.length" @click="playAll">
            <Icon name="play" :size="15" /> 播放全部
          </button>
          <button class="btn ghost sm" :disabled="!history.length" @click="onClear">清空</button>
        </div>
      </div>
    </div>

    <div v-if="!history.length" class="center-msg">
      <div>
        <div class="big"><Icon name="clock" :size="52" /></div>
        <div>还没有播放记录</div>
        <div style="margin-top: 6px">播放过的歌曲会自动出现在这里（只保存在本机）</div>
      </div>
    </div>

    <template v-else>
      <div class="song-head history-head">
        <div style="text-align: center">#</div>
        <div>歌曲</div>
        <div class="col-album">专辑</div>
        <div style="text-align: right">播放时间</div>
      </div>
      <div
        v-for="(item, i) in history"
        :key="item.key"
        class="song-row history-row"
        :class="{ active: isCurrent(item) }"
        @click="onRow(i)"
      >
        <div class="idx">
          <span class="num">{{ i + 1 }}</span>
          <button class="play-mini" :title="isPlaying(item) ? '暂停' : '播放'" @click.stop="onRow(i)">
            <Icon :name="isPlaying(item) ? 'pause' : 'play'" :size="15" />
          </button>
        </div>
        <div class="track">
          <AppImage
            :src="item.song.cover || state.matches[item.key]?.cover || ''"
            alt=""
            placeholder
          />
          <div style="min-width: 0">
            <div class="t-name">{{ item.song.name }}</div>
            <div class="t-singer">{{ item.song.singers?.join(' / ') || '未知歌手' }}</div>
          </div>
        </div>
        <div class="col-album h-album" :title="item.song.album">{{ item.song.album || '—' }}</div>
        <div class="h-time">{{ fmtTime(item.playedAt) }}</div>
      </div>
    </template>
  </div>
</template>
