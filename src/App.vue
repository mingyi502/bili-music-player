<script setup>
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { useRoute } from 'vue-router'
import Sidebar from './components/Sidebar.vue'
import TopBar from './components/TopBar.vue'
import PlayerBar from './components/PlayerBar.vue'
import QueuePanel from './components/QueuePanel.vue'
import CandidateDialog from './components/CandidateDialog.vue'
import SettingsDialog from './components/SettingsDialog.vue'
import LoginDialog from './components/LoginDialog.vue'

import DiagnosticsDialog from './components/DiagnosticsDialog.vue'
import ConfirmDialog from './components/ConfirmDialog.vue'
import AddToPlaylistDialog from './components/AddToPlaylistDialog.vue'
import ActionSheet from './components/ActionSheet.vue'
import ShareDialog from './components/ShareDialog.vue'
import UnlockGate from './components/UnlockGate.vue'
import NowPlaying from './components/NowPlaying.vue'
import Toasts from './components/Toasts.vue'
import Icon from './components/Icon.vue'
import { state, restoreSession, initAuth, closeSidebar, openSidebar, openQueue, closeQueue, toast } from './store/index'

const settingsOpen = ref(false)
const contentEl = ref(null)
const showBackTop = ref(false)
const route = useRoute()

// 窄屏冷启动默认展开左侧栏（默认界面即「歌单侧栏」）；深链接到其它页面时不展开
if (
  typeof window !== 'undefined' &&
  window.matchMedia('(max-width: 768px)').matches &&
  (location.hash === '' || location.hash === '#' || location.hash === '#/')
) {
  state.ui.sidebarOpen = true
}

/** 窄屏手势：主界面右滑开侧栏 / 左滑开播放队列；抽屉或队列展开时反向滑收起 */
let swipeStartX = 0
let swipeStartY = 0
const swipeTracking = ref(false)
function isNarrowScreen() {
  return typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches
}
function onSwipeStart(e) {
  if (!isNarrowScreen() || e.touches.length !== 1) return
  // 都收起时只在歌单主页响应（右滑开侧栏、左滑开队列）；展开时任意页面可反向滑收起
  if (!state.ui.sidebarOpen && !state.ui.queueOpen && route.path !== '/') return
  swipeStartX = e.touches[0].clientX
  swipeStartY = e.touches[0].clientY
  swipeTracking.value = true
}
function onSwipeMove(e) {
  if (!swipeTracking.value) return
  const t = e.touches[0]
  if (!t) {
    swipeTracking.value = false
    return
  }
  const dx = t.clientX - swipeStartX
  const dy = t.clientY - swipeStartY
  // 纵向滚动意图：放弃本次手势，避免与列表滚动冲突
  if (Math.abs(dy) > Math.abs(dx)) {
    swipeTracking.value = false
    return
  }
  // 方向与当前状态不符（抽屉展开应左滑、队列展开应右滑）：放弃
  if (state.ui.sidebarOpen && dx > 0) swipeTracking.value = false
  else if (state.ui.queueOpen && dx < 0) swipeTracking.value = false
}
function onSwipeEnd(e) {
  if (!swipeTracking.value) return
  swipeTracking.value = false
  const t = e.changedTouches[0]
  if (!t) return
  const dx = t.clientX - swipeStartX
  const dy = t.clientY - swipeStartY
  if (Math.abs(dx) < 60 || Math.abs(dx) <= Math.abs(dy) * 1.4) return
  if (state.ui.sidebarOpen) {
    if (dx < 0) closeSidebar()
    return
  }
  if (state.ui.queueOpen) {
    if (dx > 0) closeQueue()
    return
  }
  if (route.path !== '/') return
  if (dx > 0) openSidebar()
  else openQueue()
}
function onSwipeCancel() {
  swipeTracking.value = false
}

const locked = () => state.auth.checked && state.auth.required && !state.auth.authed

let lpHoldTimer = null
let lpTouchStart = { x: 0, y: 0 }
function onLongPressStart(e) {
  const btn = e.target.closest('button[title], .icon-btn[title], .ctrl[title], [data-title]')
  if (!btn || !e.touches[0]) return
  const hint = btn.getAttribute('title') || btn.getAttribute('data-title')
  if (!hint) return
  lpTouchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY }
  if (lpHoldTimer) clearTimeout(lpHoldTimer)
  lpHoldTimer = setTimeout(() => toast(hint, 'info'), 450)
}
function onLongPressMove(e) {
  if (!lpHoldTimer || !e.touches[0]) return
  const dx = e.touches[0].clientX - lpTouchStart.x
  const dy = e.touches[0].clientY - lpTouchStart.y
  if (Math.hypot(dx, dy) > 12) {
    clearTimeout(lpHoldTimer)
    lpHoldTimer = null
  }
}
function onLongPressEnd() {
  if (lpHoldTimer) clearTimeout(lpHoldTimer)
  lpHoldTimer = null
}

onMounted(async () => {
  // 移动端长按图标指导提示：解决触屏无鼠标悬停（Hover）导致无法获知按钮功能的问题
  // 移动端长按图标指导提示：解决触屏无鼠标悬停（Hover）导致无法获知按钮功能的问题
  window.addEventListener('touchstart', onLongPressStart, { passive: true })
  window.addEventListener('touchmove', onLongPressMove, { passive: true })
  window.addEventListener('touchend', onLongPressEnd, { passive: true })
  window.addEventListener('touchcancel', onLongPressEnd, { passive: true })

  const st = await initAuth()
  if (st.reachable && st.authRequired && !st.authed) return // 等解锁
  restoreSession()
})

function onUnlocked() {
  restoreSession()
}

onBeforeUnmount(() => {
  window.removeEventListener('touchstart', onLongPressStart)
  window.removeEventListener('touchmove', onLongPressMove)
  window.removeEventListener('touchend', onLongPressEnd)
  window.removeEventListener('touchcancel', onLongPressEnd)
  onLongPressEnd()
})

/** 滚出约一屏后显示「返回顶部」 */
function onContentScroll() {
  const el = contentEl.value
  if (!el) return
  showBackTop.value = el.scrollTop > el.clientHeight * 0.9
}

function scrollToTop() {
  contentEl.value?.scrollTo({ top: 0, behavior: 'smooth' })
}

/** 滚动到当前正在播放的那一行并短暂高亮 */
function scrollToCurrent() {
  const find = () => document.querySelector('.song-row.active')
  const go = (el) => {
    if (!el) return
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    el.classList.remove('locate-flash')
    void el.offsetWidth
    el.classList.add('locate-flash')
    setTimeout(() => el.classList.remove('locate-flash'), 1500)
  }
  const el = find()
  if (el) return go(el)
  if (state.filter) {
    state.filter = ''
    setTimeout(() => go(find()), 60)
  }
}

// 切换歌单时回到顶部，避免停在上一个歌单的滚动位置
watch(
  () => state.playlist && state.playlist.id,
  () => {
    contentEl.value?.scrollTo({ top: 0 })
    showBackTop.value = false
  }
)
</script>

<template>
  <div class="app">
    <div
      class="body"
      @touchstart.passive="onSwipeStart"
      @touchmove.passive="onSwipeMove"
      @touchend.passive="onSwipeEnd"
      @touchcancel.passive="onSwipeCancel"
    >
      <Sidebar @open-settings="settingsOpen = true" @open-login="state.loginOpen = true" />
      <div
        v-if="state.ui.sidebarOpen"
        class="drawer-backdrop"
        @click="closeSidebar"
      ></div>
      <main class="main">
        <TopBar @open-settings="settingsOpen = true" />
        <div ref="contentEl" class="content" @scroll.passive="onContentScroll">
          <RouterView />
        </div>
      </main>
    </div>

    <!-- 右下角悬浮按钮 -->
    <div class="float-btns">
      <button v-if="showBackTop" class="float-btn" title="返回顶部" @click="scrollToTop">
        <Icon name="chevronUp" :size="22" />
      </button>
      <button
        v-if="state.player.index >= 0"
        class="float-btn locate"
        title="定位到正在播放的歌曲"
        @click="scrollToCurrent"
      >
        <Icon name="target" :size="20" />
      </button>
    </div>

    <PlayerBar />
    <QueuePanel />
    <NowPlaying />
    <!-- 导入歌单进度（P7.4 G5） -->
    <div v-if="state.ui.importBusy" class="import-busy">
      <span class="spin"><Icon name="refresh" :size="14" /></span>
      <span>{{ state.ui.importText || '正在导入…' }}</span>
    </div>
    <CandidateDialog />
    <LoginDialog
      :open="state.loginOpen"
      @close="state.loginOpen = false"
      @open-settings="settingsOpen = true"
    />
    <DiagnosticsDialog />
    <AddToPlaylistDialog />
    <ActionSheet />
    <ShareDialog />
    <ConfirmDialog />
    <SettingsDialog :open="settingsOpen" @close="settingsOpen = false" />
    <UnlockGate v-if="locked()" @unlocked="onUnlocked" />
    <Toasts />
  </div>
</template>
