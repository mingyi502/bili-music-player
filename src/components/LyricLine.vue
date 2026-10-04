<script setup>
/**
 * 逐词歌词行（P8.4 重构）。
 *
 * - 只有 `active` 行读取 `lyricNow` 计算词进度：非当前行完全静态，每帧只重渲染当前行
 * - 配色统一为一族：未唱 = `--text-dim`；已唱 = `--brand`；当前词 = 品牌绿按进度扫过
 *   （填满即已唱同色，完成瞬间零跳变）
 * - `--wp` 使用 0.1% 精度（toFixed(1)），避免整数百分比造成的"一顿一顿"
 */
import { computed } from 'vue'
import { wordState } from '../utils/qrc.js'
import { toLyricTime } from '../utils/lrc.js'
import { lyricNow } from '../store/index'

const props = defineProps({
  line: { type: Object, required: true },
  active: Boolean,
  karaoke: Boolean,
  showRoma: Boolean,
  offsetMs: { type: Number, default: 0 },
})
const emit = defineEmits(['seek'])

/** 词状态：仅当前行、开启逐字、非信息行、且行内有词时才计算 */
const ws = computed(() => {
  if (!props.active || !props.karaoke || props.line.credit) return null
  const words = props.line.words
  if (!words?.length) return null
  return wordState(words, toLyricTime(lyricNow.value, props.offsetMs))
})

/** 当前词进度（0.1% 精度） */
const wpPct = computed(() => {
  const p = ws.value ? Math.min(Math.max(ws.value.progress, 0), 1) : 0
  return (Math.round(p * 1000) / 10).toFixed(1) + '%'
})
</script>

<template>
  <div class="np-lyric-line" :class="{ active, credit: line.credit }" @click.stop="emit('seek', line)">
    <div class="l-text">
      <template v-if="ws">
        <span
          v-for="(w, wi) in line.words"
          :key="wi"
          class="l-word"
          :class="{ done: wi < ws.index, active: wi === ws.index }"
          :style="wi === ws.index ? { '--wp': wpPct } : null"
          >{{ w.text }}</span
        >
      </template>
      <template v-else>{{ line.text || '♪' }}</template>
    </div>
    <div v-if="line.roma && showRoma" class="l-roma">{{ line.roma }}</div>
    <div v-if="line.trans" class="l-trans">{{ line.trans }}</div>
  </div>
</template>
