<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useImage } from '../utils/mediaCache'

const props = defineProps({
  src: { type: String, default: '' },
  alt: { type: String, default: '' },
  lazy: { type: Boolean, default: true },
  /** 无封面 / 最终加载失败时显示音符占位（默认保持旧的「灰块、不显示裂图」行为） */
  placeholder: { type: Boolean, default: false },
})

// 解析结果（Web 端首帧即为最终地址；移动端会异步更新为本地 blob URL）
const resolved = useImage(() => props.src)
// 加载失败：保留占位、不显示裂图（与原实现一致）
const broken = ref(false)
// 网络抖动导致的偶发失败自动重试，避免「失败一次就永久空白」
const attempt = ref(0)
const MAX_RETRY = 1
let retryTimer = null

// 仅在「确实没有封面」或「重试后仍失败」时才显示占位；
// 移动端首帧 src 为空（还没解析出来）不算失败，避免占位图标一闪而过。
const showPlaceholder = computed(
  () => props.placeholder && (!props.src || (broken.value && attempt.value >= MAX_RETRY)),
)

// 浏览器/WebView 对空 src 或加载失败会画一个"裂图"小图标（naturalWidth=0），
// 会盖在我们的音符占位上面；所以占位时改用 1x1 透明像素，让 img 处于"已加载"状态。
const BLANK_PX = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
const imgSrc = computed(() => (showPlaceholder.value ? BLANK_PX : resolved.value))

// ⚠️ 移动端首帧 src 为空，浏览器会对空 src 触发 error；此时**不能**标记为失败，
// 否则图片即便随后加载成功也会被 visibility:hidden 隐藏（曾导致 B站封面全部不显示）
function onError() {
  if (!resolved.value) return
  if (attempt.value >= MAX_RETRY) {
    broken.value = true
    return
  }
  if (retryTimer) return
  retryTimer = setTimeout(() => {
    retryTimer = null
    // 改 key 让 <img> 重建，浏览器会用同一地址重新发起请求
    attempt.value += 1
    broken.value = false
  }, 1200)
}

function onLoad() {
  if (showPlaceholder.value) return
  broken.value = false
}

// 地址变化时重置，允许重新尝试
watch(resolved, () => {
  broken.value = false
  attempt.value = 0
})

onBeforeUnmount(() => {
  if (retryTimer) clearTimeout(retryTimer)
})
</script>

<template>
  <img
    :key="attempt"
    class="app-img"
    :class="{ broken, ph: showPlaceholder }"
    :src="imgSrc"
    :alt="alt"
    :loading="lazy ? 'lazy' : 'eager'"
    referrerpolicy="no-referrer"
    @error="onError"
    @load="onLoad"
  />
</template>
