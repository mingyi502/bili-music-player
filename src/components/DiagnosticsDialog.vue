<script setup>
import { computed, ref } from 'vue'
import Icon from './Icon.vue'
import { state, runDiagnostics, toast } from '../store/index'

const copied = ref(false)

const diag = computed(() => state.diagnostics)
const hasFailures = computed(() => diag.value.checks.some((c) => c.ok === false))

function scrubSensitiveText(value) {
  return String(value || '')
    .replace(/https?:\/\/\S+/gi, '[上游地址]')
    .replace(/((?:qm_keyst|qqmusic_key|p_skey|skey|SESSDATA|bili_jct))=([^;\s&]+)/gi, '$1=[已隐藏]')
    .replace(/((?:uin|p_uin|pt2gguin|superuin|wxuin))=o?\d{5,}/gi, '$1=[已隐藏]')
    .replace(/\b\d{5,}\b/g, '[数字已隐藏]')
}

const reportText = computed(() => {
  const lines = ['===== bili-music-player 诊断报告 =====', `时间：${new Date().toLocaleString()}`]
  lines.push('页面来源：本地应用')
  lines.push(`网络状态：${navigator.onLine ? '在线' : '离线'}`)
  lines.push(`结论：${scrubSensitiveText(diag.value.verdict || '（未检测）')}`, '')
  lines.push('【功能检查】')
  for (const c of diag.value.checks) {
    const tag = c.ok === true ? 'OK' : c.ok === false ? 'FAIL' : 'WARN'
    lines.push(`- [${tag}] ${c.label}: ${scrubSensitiveText(c.detail)}${c.suggestion ? `（建议：${scrubSensitiveText(c.suggestion)}）` : ''}`)
  }
  if (diag.value.errors.length) {
    lines.push('', '【运行时错误】')
    for (const e of diag.value.errors) lines.push(`- [${e.time}] ${e.scope}: ${scrubSensitiveText(e.message)}`)
  }
  lines.push('', `登录 Cookie：${state.config.qqCookie ? '已配置（值不包含在报告中）' : '未配置'}`)
  return lines.join('\n')
})

async function copyReport() {
  try {
    await navigator.clipboard.writeText(reportText.value)
    copied.value = true
    setTimeout(() => (copied.value = false), 1500)
  } catch {
    toast('复制失败，请手动选择文本复制', 'error')
  }
}

function statusIcon(ok) {
  return ok === true ? 'check' : ok === false ? 'close' : 'refresh'
}
</script>

<template>
  <div v-if="diag.open" class="overlay" @click.self="diag.open = false">
    <div class="dialog">
      <div class="dialog-head">
        <h3>自检诊断</h3>
        <button class="icon-btn" @click="diag.open = false"><Icon name="close" :size="16" /></button>
      </div>

      <div class="dialog-body">
        <div class="verdict" :class="hasFailures ? 'bad' : 'good'">
          <Icon :name="hasFailures ? 'close' : 'check'" :size="16" />
          <span>{{ diag.verdict || '尚未检测' }}</span>
        </div>

        <div v-if="diag.running" class="center-msg" style="height: 120px">
          <span class="spin"><Icon name="refresh" :size="26" /></span>
        </div>

        <template v-else>
          <div class="check-list">
            <div v-for="(c, i) in diag.checks" :key="i" class="check" :class="{ bad: c.ok === false, warn: c.ok === null }">
              <span class="check-icon"><Icon :name="statusIcon(c.ok)" :size="15" /></span>
              <div class="check-text">
                <div class="check-label">{{ c.label }}</div>
                <div class="check-detail">{{ c.detail }}</div>
                <div v-if="c.suggestion && c.ok !== true" class="check-suggest">建议：{{ c.suggestion }}</div>
              </div>
            </div>
          </div>

          <div v-if="diag.errors.length" class="errors">
            <div class="errors-title">运行时错误（{{ diag.errors.length }}）</div>
            <div v-for="(e, i) in diag.errors" :key="i" class="error-row">
              <span class="error-time">{{ e.time }}</span>
              <span class="error-scope">{{ e.scope }}</span>
              <span class="error-msg">{{ e.message }}</span>
            </div>
          </div>

          <div v-if="!diag.checks.length" class="empty-hint">
            还没有检测结果。点击「重新检测」开始。
          </div>
        </template>
      </div>

      <div class="dialog-foot">
        <button class="btn ghost" @click="copyReport">
          <Icon :name="copied ? 'check' : 'link'" :size="15" /> {{ copied ? '已复制' : '复制报告' }}
        </button>
        <button class="btn primary" :disabled="diag.running" @click="runDiagnostics">
          <Icon name="refresh" :size="15" :class="{ spin: diag.running }" /> 重新检测
        </button>
      </div>
    </div>
  </div>
</template>
