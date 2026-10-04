<script setup>
import { computed, ref } from 'vue'
import Icon from './Icon.vue'
import AppImage from './AppImage.vue'
import SleepTimerButton from './SleepTimerButton.vue'
import { state, store, togglePlay, next, prev, seekRatio, cycleMode, expandPlayer, switchCurrentSource, sourceFor, toggleQueue, favOf, favPending, toggleFav } from '../store/index'

const song = computed(() => store.currentSong.value)
const match = computed(() => store.currentMatch.value)
const video = computed(() => store.currentVideo.value)
const cover = computed(() => song.value?.cover || video.value?.cover || '')
const title = computed(() => song.value?.name || '未在播放')
const sub = computed(() => {
  if (!song.value) return '选择一首歌开始播放'
  const singer = song.value.singers.join(' / ')
  if (state.player.loading && state.player.loadingText) return state.player.loadingText
  const sourceLabel =
    state.player.source === 'qq' ? 'QQ音乐音源' : state.player.source === 'bili' ? 'B站音源' : state.player.source === 'iframe' ? '内嵌播放' : ''
  return sourceLabel ? `${singer} · ${sourceLabel}` : singer
})

/** 这首歌当前会用的音源（含用户偏好，未播放时也能显示） */
const prefSource = computed(() => (song.value ? sourceFor(song.value) : 'bili'))
const prefLabel = computed(() => (prefSource.value === 'qq' ? 'QQ音乐' : 'B站'))

const canSeek = computed(() => state.player.source === 'qq' || state.player.source === 'bili' || state.player.source === 'local')
const modeLabel = computed(
  () => ({ order: '顺序播放', repeat: '单曲循环', shuffle: '随机播放' })[state.player.mode] || '顺序播放'
)
const modeIcon = computed(
  () => ({ order: 'repeat', repeat: 'repeatOne', shuffle: 'shuffle' })[state.player.mode] || 'repeat'
)

const barEl = ref(null)
const dragging = ref(false)
const dragRatio = ref(0)
const hovering = ref(false)
const hoverRatio = ref(0)

function onHoverMove(e) {
  if (canSeek.value && barEl.value) {
    hoverRatio.value = ratioAt(e.clientX)
  }
}
/** 拖动中只本地预览（跟手指），松手才真正 seek —— 避免连续写 currentTime 打断流式缓冲 */
const displayRatio = computed(() => (dragging.value ? dragRatio.value : store.progress.value / 100))
const displayElapsed = computed(() =>
  dragging.value ? dragRatio.value * (store.currentDuration.value || 0) : store.elapsed.value
)

function fmt(sec) {
  if (!sec || !isFinite(sec)) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

function ratioAt(clientX) {
  const el = barEl.value
  if (!el) return 0
  const rect = el.getBoundingClientRect()
  return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
}

function onDown(e) {
  if (!canSeek.value) return
  dragging.value = true
  dragRatio.value = ratioAt(e.clientX)
  try {
    barEl.value?.setPointerCapture?.(e.pointerId)
  } catch {
    /* 合成事件 / 指针已失效时忽略 */
  }
}
function onMove(e) {
  if (!dragging.value) return
  dragRatio.value = ratioAt(e.clientX)
}
function onUp() {
  if (!dragging.value) return
  dragging.value = false
  seekRatio(dragRatio.value)
}
</script>

<template>
  <div class="player">
    <div class="now-playing" :title="song ? '点开全屏播放器' : ''" @click="expandPlayer">
      <div class="np-cover-box">
        <AppImage v-if="cover" :src="cover" alt="" :lazy="false" />
        <div v-else class="icon-btn" style="width: 56px; height: 56px">
          <Icon name="music" :size="22" />
        </div>
        <div v-if="state.player.playing" class="np-eq-badge" aria-hidden="true" title="正在播放">
          <span class="eq-bar"></span>
          <span class="eq-bar"></span>
          <span class="eq-bar"></span>
        </div>
      </div>
      <div class="np-text">
        <div class="np-title">{{ title }}</div>
        <div class="np-sub">{{ sub }}</div>
      </div>
    </div>

    <div class="player-center">
      <div class="controls">
        <button
          class="ctrl mode"
          :class="{ on: state.player.mode !== 'order' }"
          :title="'播放模式：' + modeLabel + '（点击切换）'"
          @click="cycleMode"
        >
          <Icon :name="modeIcon" :size="17" />
        </button>
        <button class="ctrl" :disabled="!state.queue.length" title="上一首" @click="prev">
          <Icon name="prev" :size="20" />
        </button>
        <button class="ctrl play" :disabled="!state.queue.length" title="播放/暂停" @click="togglePlay">
          <Icon
            :name="state.player.loading ? 'refresh' : state.player.playing ? 'pause' : 'play'"
            :size="18"
            :class="{ spin: state.player.loading }"
          />
        </button>
        <button class="ctrl" :disabled="!state.queue.length" title="下一首" @click="next()">
          <Icon name="next" :size="20" />
        </button>
      </div>
      <div class="progress-wrap">
        <span>{{ fmt(displayElapsed) }}</span>
        <div
          ref="barEl"
          class="bar"
          :class="{ static: !canSeek, dragging }"
          @pointerdown="onDown"
          @pointermove="onMove"
          @pointerup="onUp"
          @pointercancel="onUp"
          @pointerenter="hovering = true"
          @pointerleave="hovering = false"
          @mousemove="onHoverMove"
        >
          <div class="fill" :style="{ width: displayRatio * 100 + '%' }" />
          <div
            v-if="hovering && canSeek && store.currentDuration.value"
            class="bar-tooltip"
            :style="{ left: Math.max(0.04, Math.min(0.96, hoverRatio)) * 100 + '%' }"
          >
            {{ fmt(hoverRatio * store.currentDuration.value) }}
          </div>
        </div>
        <span>{{ fmt(store.currentDuration.value) }}</span>
      </div>
    </div>

    <div class="player-right">
      <button
        v-if="song"
        class="icon-btn fav-btn"
        :class="{ on: favOf(song) }"
        :disabled="favPending(song)"
        :title="favOf(song) ? '取消喜欢' : '喜欢'"
        @click="toggleFav(song)"
      >
        <Icon name="heart" :size="18" />
      </button>
      <SleepTimerButton />
      <button
        class="icon-btn queue-btn"
        :class="{ on: state.ui.queueOpen }"
        title="播放队列"
        @click="toggleQueue"
      >
        <Icon name="playlist" :size="17" />
        <span v-if="state.queue.length" class="queue-badge">{{ state.queue.length }}</span>
      </button>
      <span v-if="match && match.status === 'loading'" class="badge loading">
        <Icon name="refresh" :size="12" class="spin" /> 匹配中
      </span>
      <button
        v-if="song"
        class="src-btn"
        :class="prefSource"
        :title="`当前音源：${prefLabel}。点击切换为${prefSource === 'qq' ? 'B站' : 'QQ音乐'}音源`"
        @click="switchCurrentSource"
      >
        <Icon :name="prefSource === 'qq' ? 'qqMusic' : 'bilibili'" :size="14" /> {{ prefLabel }}
      </button>
      <a
        v-if="video"
        class="bili-btn"
        :href="video.url"
        target="_blank"
        rel="noreferrer"
        :title="video.title"
      >
        <Icon name="video" :size="14" /> B站
      </a>
    </div>
  </div>
</template>
