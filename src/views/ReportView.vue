<script setup>
/** 听歌报告（P7.3 G4）：基于本地收听事件（bmp:listen-stats）的统计视图。 */
import { computed, ref } from 'vue'
import Icon from '../components/Icon.vue'
import { state, statsFor, clearStats, askConfirm, toast } from '../store/index'
import { formatListenDuration } from '../api/stats.js'

const RANGES = [
  { days: 7, label: '近 7 天' },
  { days: 30, label: '近 30 天' },
  { days: 0, label: '全部' },
]

const range = ref(7)
const summary = computed(() => statsFor(range.value))
const hasData = computed(() => state.listenStats.length > 0)
const maxHour = computed(() => Math.max(1, ...summary.value.byHour))
const maxDay = computed(() => Math.max(1, ...summary.value.byDay.map((d) => d.plays)))
const hourPct = (n) => (n > 0 ? Math.max(4, Math.round((n / maxHour.value) * 100)) : 0)
const dayPct = (n) => (n > 0 ? Math.max(4, Math.round((n / maxDay.value) * 100)) : 0)
const dayLabel = (day) => String(day).slice(5)

async function onClear() {
  const ok = await askConfirm({
    title: '清空听歌统计',
    message: '将删除本机记录的全部收听事件（次数 / 时长 / 排行），此操作不可撤销。',
    confirmText: '清空',
    danger: true,
  })
  if (ok) {
    clearStats()
    toast('已清空听歌统计', 'success')
  }
}
</script>

<template>
  <div class="report-view">
    <div class="rp-head">
      <div class="rp-title"><Icon name="chart" :size="18" /> 听歌报告</div>
      <div class="rp-sub">
        纯本地统计 · 共 {{ state.listenStats.length }} 条收听记录<span v-if="summary.totalMs"> · 已听 {{ formatListenDuration(summary.totalMs) }}</span>
      </div>
      <div class="rp-actions">
        <div class="rp-tabs">
          <button
            v-for="r in RANGES"
            :key="r.label"
            class="rp-tab"
            :class="{ active: range === r.days }"
            @click="range = r.days"
          >
            {{ r.label }}
          </button>
        </div>
        <button class="btn ghost sm" :disabled="!hasData" @click="onClear"><Icon name="trash" :size="14" /> 清空</button>
      </div>
    </div>

    <div v-if="!hasData" class="center-msg">还没有听歌记录，去播放几首吧</div>

    <template v-else>
      <div class="rp-cards">
        <div class="rp-card">
          <div class="rp-num">{{ summary.totalPlays }}</div>
          <div class="rp-label">播放次数</div>
        </div>
        <div class="rp-card">
          <div class="rp-num">{{ formatListenDuration(summary.totalMs) }}</div>
          <div class="rp-label">听歌时长</div>
        </div>
        <div class="rp-card">
          <div class="rp-num">{{ summary.uniqueSongs }}</div>
          <div class="rp-label">歌曲数</div>
        </div>
        <div class="rp-card">
          <div class="rp-num">{{ summary.uniqueSingers }}</div>
          <div class="rp-label">歌手数</div>
        </div>
      </div>

      <div class="rp-section">
        <div class="rp-section-title">歌曲排行</div>
        <div v-if="!summary.topSongs.length" class="rp-empty">该时段暂无记录</div>
        <div v-for="(s, i) in summary.topSongs" :key="s.key" class="rp-row">
          <div class="rp-rank">{{ i + 1 }}</div>
          <div class="rp-main">
            <div class="rp-name">{{ s.name }}</div>
            <div class="rp-meta">{{ (s.singers || []).join(' / ') || '未知歌手' }}</div>
          </div>
          <div class="rp-val">
            {{ s.plays }} 次<template v-if="s.ms"> · {{ formatListenDuration(s.ms) }}</template>
          </div>
        </div>
      </div>

      <div class="rp-section">
        <div class="rp-section-title">歌手排行</div>
        <div v-if="!summary.topSingers.length" class="rp-empty">该时段暂无记录</div>
        <div v-for="(s, i) in summary.topSingers" :key="s.name" class="rp-row">
          <div class="rp-rank">{{ i + 1 }}</div>
          <div class="rp-main">
            <div class="rp-name">{{ s.name }}</div>
          </div>
          <div class="rp-val">{{ s.plays }} 次</div>
        </div>
      </div>

      <div class="rp-section">
        <div class="rp-section-title">时段分布（0–23 时）</div>
        <div class="rp-bars hours">
          <div v-for="(n, h) in summary.byHour" :key="h" class="rp-bar-wrap" :title="`${h} 时 · ${n} 次`">
            <div class="rp-bar" :style="{ height: hourPct(n) + '%' }"></div>
            <div class="rp-bar-label">{{ h % 6 === 0 ? h : '' }}</div>
          </div>
        </div>
      </div>

      <div class="rp-section">
        <div class="rp-section-title">每日趋势（有记录的最近 {{ summary.byDay.length }} 天）</div>
        <div v-if="!summary.byDay.length" class="rp-empty">该时段暂无记录</div>
        <div v-else class="rp-bars days">
          <div v-for="d in summary.byDay" :key="d.day" class="rp-bar-wrap" :title="`${d.day} · ${d.plays} 次`">
            <div class="rp-bar" :style="{ height: dayPct(d.plays) + '%' }"></div>
            <div class="rp-bar-label">{{ dayLabel(d.day) }}</div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
