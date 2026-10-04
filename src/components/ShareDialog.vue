<script setup>
/**
 * 分享面板（P5 E3）：复制链接 + 二维码 +（App）系统分享。
 * 由 `openShare({ title, subtitle, url })` 打开；Web 无系统分享后端，自动隐藏对应按钮。
 */
import { ref, watch, nextTick } from 'vue'
import QRCode from 'qrcode'
import Icon from './Icon.vue'
import { state, closeShare, toast } from '../store/index'
import { writeClipboard } from '../core/clipboard'
import { canSystemShare, systemShare } from '../core/share'

const canvas = ref(null)
const copied = ref(false)
const busy = ref(false)

watch(
  () => state.ui.share.open,
  async (open) => {
    if (!open) return
    copied.value = false
    await nextTick()
    try {
      if (canvas.value) {
        await QRCode.toCanvas(canvas.value, state.ui.share.url, {
          width: 176,
          margin: 1,
          color: { dark: '#111114', light: '#ffffff' },
        })
      }
    } catch {
      /* 二维码渲染失败不阻塞复制/分享 */
    }
  }
)

async function copyLink() {
  try {
    await writeClipboard(state.ui.share.url)
    copied.value = true
    toast('链接已复制', 'success')
    setTimeout(() => (copied.value = false), 1600)
  } catch {
    toast('复制失败，请长按链接手动复制', 'error')
  }
}

async function doSystemShare() {
  if (busy.value) return
  busy.value = true
  try {
    await systemShare({ title: state.ui.share.title, text: state.ui.share.subtitle, url: state.ui.share.url })
  } catch (e) {
    toast(e?.message || '系统分享失败', 'error')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div v-if="state.ui.share.open" class="overlay" @click.self="closeShare">
    <div class="dialog share-dialog">
      <div class="dialog-head">
        <h3>分享</h3>
        <button class="icon-btn" @click="closeShare"><Icon name="close" :size="16" /></button>
      </div>
      <div class="share-body">
        <div class="share-title">{{ state.ui.share.title }}</div>
        <div v-if="state.ui.share.subtitle" class="share-sub">{{ state.ui.share.subtitle }}</div>
        <canvas ref="canvas" class="share-qr"></canvas>
        <div class="share-url" :title="state.ui.share.url">{{ state.ui.share.url }}</div>
        <div class="share-actions">
          <button class="btn" @click="copyLink">
            <Icon :name="copied ? 'check' : 'link'" :size="15" /> {{ copied ? '已复制' : '复制链接' }}
          </button>
          <button v-if="canSystemShare()" class="btn primary" :disabled="busy" @click="doSystemShare">
            <Icon name="share" :size="15" /> 系统分享
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
