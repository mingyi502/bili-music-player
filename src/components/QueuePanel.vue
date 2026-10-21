<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import Icon from './Icon.vue'
import AppImage from './AppImage.vue'
import { state, playQueueItem, removeFromQueue, moveQueueItem, clearQueue, closeQueue, togglePlay } from '../store/index'

const dragFrom = ref(-1)
const dragOver = ref(-1)

const queue = computed(() => state.queue)
const currentIndex = computed(() => state.player.queueIndex)

// 队列最多 500 首；一次创建 500 个队列行 + 500 个图片懒加载观察器会造成
// 右滑打开面板时掉帧。与歌单一致：首屏 80 行，滚到底部再追加。
const RENDER_STEP = 80
const renderLimit = ref(RENDER_STEP)
const visibleQueue = computed(() => queue.value.slice(0, renderLimit.value))
const hasMoreRows = computed(() => queue.value.length > renderLimit.value)
const loadMoreEl = ref(null)
let moreObserver = null

function disconnectMoreObserver() {
  if (moreObserver) moreObserver.disconnect()
  moreObserver = null
}

function connectMoreObserver() {
  disconnectMoreObserver()
  if (!hasMoreRows.value || !loadMoreEl.value || typeof IntersectionObserver === 'undefined') return
  moreObserver = new IntersectionObserver(
    (entries) => {
      if (!entries.some((e) => e.isIntersecting) || !hasMoreRows.value) return
      renderLimit.value = Math.min(queue.value.length, renderLimit.value + RENDER_STEP)
      nextTick(connectMoreObserver)
    },
    { root: document.querySelector('.queue-list'), rootMargin: '200px' }
  )
  moreObserver.observe(loadMoreEl.value)
}

watch(
  () => state.ui.queueOpen,
  (open) => {
    if (!open) {
      disconnectMoreObserver()
      return
    }
    // 首屏固定 80 行，保证右滑展开立刻响应；当前曲可能在更下方，滚动时再追加
    renderLimit.value = RENDER_STEP
    nextTick(connectMoreObserver)
  }
)
watch(hasMoreRows, () => nextTick(connectMoreObserver))
onBeforeUnmount(disconnectMoreObserver)

/** 移动端右滑收起（与侧栏左滑收起对称；面板铺满时手势落在此层） */
let swipeStartX = 0
let swipeStartY = 0
let swipeTracking = false
function onPanelSwipeStart(e) {
  if (e.touches.length !== 1) return
  swipeStartX = e.touches[0].clientX
  swipeStartY = e.touches[0].clientY
  swipeTracking = true
}
function onPanelSwipeMove(e) {
  if (!swipeTracking) return
  const t = e.touches[0]
  if (!t) {
    swipeTracking = false
    return
  }
  const dx = t.clientX - swipeStartX
  const dy = t.clientY - swipeStartY
  if (dx < 0 || Math.abs(dy) > Math.abs(dx)) swipeTracking = false
}
function onPanelSwipeEnd(e) {
  if (!swipeTracking) return
  swipeTracking = false
  const t = e.changedTouches[0]
  if (!t) return
  const dx = t.clientX - swipeStartX
  const dy = t.clientY - swipeStartY
  if (dx >= 60 && dx > Math.abs(dy) * 1.4) closeQueue()
}
function onPanelSwipeCancel() {
  swipeTracking = false
}

function onRowClick(i) {
  if (i === currentIndex.value) togglePlay()
  else playQueueItem(i)
}

/** 指针拖动排序（桌面鼠标 + 触屏通用） */
function onHandleDown(e, i) {
  e.preventDefault()
  dragFrom.value = i
  dragOver.value = i
  const onMove = (ev) => {
    const el = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('[data-q-index]')
    if (el) dragOver.value = Number(el.dataset.qIndex)
  }
  const onUp = () => {
    if (dragFrom.value >= 0 && dragOver.value >= 0 && dragFrom.value !== dragOver.value) {
      moveQueueItem(dragFrom.value, dragOver.value)
    }
    dragFrom.value = -1
    dragOver.value = -1
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
}
</script>

<template>
  <div
    v-if="state.ui.queueOpen"
    class="queue-overlay"
    @click.self="closeQueue"
    @touchstart.passive="onPanelSwipeStart"
    @touchmove.passive="onPanelSwipeMove"
    @touchend.passive="onPanelSwipeEnd"
    @touchcancel.passive="onPanelSwipeCancel"
  >
    <div class="queue-panel">
      <div class="queue-head">
        <div class="queue-title">
          <Icon name="playlist" :size="16" /> 播放队列
          <span class="queue-count">{{ queue.length }}</span>
        </div>
        <div class="queue-head-actions">
          <button class="btn ghost sm" :disabled="!queue.length" @click="clearQueue">清空</button>
          <button class="icon-btn" title="关闭" @click="closeQueue"><Icon name="close" :size="16" /></button>
        </div>
      </div>

      <div v-if="!queue.length" class="queue-empty">队列是空的：点歌曲行即可开始播放</div>
      <div v-else class="queue-list">
        <div
          v-for="(item, i) in visibleQueue"
          :key="item.key"
          class="queue-item"
          :class="{ active: i === currentIndex, dragging: i === dragFrom, over: i === dragOver && i !== dragFrom }"
          :data-q-index="i"
          @click="onRowClick(i)"
        >
          <button class="q-handle" title="拖动排序" @pointerdown="onHandleDown($event, i)" @click.stop>
            <Icon name="drag" :size="14" />
          </button>
          <span class="q-idx">
            <Icon v-if="i === currentIndex && state.player.playing" name="play" :size="11" />
            <template v-else>{{ i + 1 }}</template>
          </span>
          <AppImage class="q-cover" :src="item.song.cover || state.matches[item.key]?.cover || ''" alt="" placeholder />
          <div class="q-text">
            <div class="q-name">{{ item.song.name }}</div>
            <div class="q-singer">{{ item.song.singers?.join(' / ') || '未知歌手' }}</div>
          </div>
          <button class="icon-btn q-remove" title="移出队列" @click.stop="removeFromQueue(i)">
            <Icon name="close" :size="14" />
          </button>
        </div>
        <div v-if="hasMoreRows" ref="loadMoreEl" class="load-more-rows">
          正在加载更多歌曲…
        </div>
      </div>
    </div>
  </div>
</template>
