<script setup>
import { ref, onMounted } from 'vue'
import Icon from './Icon.vue'
import { unlockAccess } from '../store/index'

const emit = defineEmits(['unlocked'])

const code = ref('')
const error = ref('')
const busy = ref(false)
const inputEl = ref(null)

async function submit() {
  if (busy.value) return
  const value = code.value.trim()
  if (!value) {
    error.value = '请输入访问口令'
    return
  }
  busy.value = true
  error.value = ''
  try {
    await unlockAccess(value)
    emit('unlocked')
  } catch (e) {
    error.value = e.message || '口令校验失败'
  } finally {
    busy.value = false
  }
}

onMounted(() => inputEl.value?.focus())
</script>

<template>
  <div class="overlay unlock-overlay">
    <div class="unlock-card">
      <div class="unlock-icon"><Icon name="settings" :size="26" /></div>
      <h2>需要访问口令</h2>
      <p class="unlock-desc">
        当前是<b>局域网模式</b>，为防止代理被他人使用，需要输入访问口令。<br />
        口令显示在<b>启动服务的终端窗口</b>里（每次重启都会变化）。
      </p>
      <div class="unlock-row">
        <input
          ref="inputEl"
          v-model="code"
          class="input unlock-input"
          type="text"
          inputmode="numeric"
          autocomplete="one-time-code"
          placeholder="请输入访问口令"
          @keyup.enter="submit"
        />
        <button class="btn primary" :disabled="busy" @click="submit">
          <Icon :name="busy ? 'refresh' : 'check'" :size="15" :class="{ spin: busy }" /> 解锁
        </button>
      </div>
      <div v-if="error" class="unlock-error">{{ error }}</div>
      <p class="unlock-hint">
        提示：如果这是在公共 Wi-Fi 下，建议关闭局域网模式（改用 <code>npm run dev</code> 并插 USB 线调试）。
      </p>
    </div>
  </div>
</template>
