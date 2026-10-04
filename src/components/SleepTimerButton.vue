<script setup>
import { computed, ref, onMounted, onBeforeUnmount } from 'vue'
import Icon from './Icon.vue'
import { state, setSleepTimer, cancelSleepTimer } from '../store/index'

const open = ref(false)
const OPTIONS = [15, 30, 60, 90]

const active = computed(() => state.sleep.endsAt > 0)
/** 完整倒计时（菜单标题用）：15:00 / 45s */
const remainingText = computed(() => {
  const s = state.sleep.remaining
  if (!active.value || s <= 0) return ''
  const m = Math.floor(s / 60)
  return m > 0 ? `${m}:${String(s % 60).padStart(2, '0')}` : `${s}s`
})
/** 按钮角标（紧凑）：15m / 45s */
const badgeText = computed(() => {
  const s = state.sleep.remaining
  if (!active.value || s <= 0) return ''
  return s >= 60 ? `${Math.floor(s / 60)}m` : `${s}s`
})

function pick(minutes) {
  open.value = false
  setSleepTimer(minutes)
}
function cancel() {
  open.value = false
  cancelSleepTimer()
}
function onDocClick(e) {
  if (!e.target.closest('.sleep-wrap')) open.value = false
}
onMounted(() => document.addEventListener('click', onDocClick))
onBeforeUnmount(() => document.removeEventListener('click', onDocClick))
</script>

<template>
  <div class="sleep-wrap">
    <button
      class="icon-btn sleep-btn"
      :class="{ on: active }"
      :title="active ? `睡眠定时：剩余 ${remainingText}` : '睡眠定时'"
      @click.stop="open = !open"
    >
      <Icon name="moon" :size="17" />
      <span v-if="active" class="sleep-badge">{{ badgeText }}</span>
    </button>
    <div v-if="open" class="sleep-menu" @click.stop>
      <div class="sleep-menu-title">
        睡眠定时<span v-if="active"> · 剩余 {{ remainingText }}</span>
      </div>
      <button v-for="m in OPTIONS" :key="m" class="sleep-opt" @click="pick(m)">{{ m }} 分钟</button>
      <button class="sleep-opt cancel" :disabled="!active" @click="cancel">关闭定时</button>
    </div>
  </div>
</template>
