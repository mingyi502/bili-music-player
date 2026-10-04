<script setup>
import Icon from './Icon.vue'
import { state, resolveConfirm } from '../store/index'

/** 通用二次确认弹窗（P4.0）：由 askConfirm() 打开，危险操作确认键用红色 */
function ok() {
  resolveConfirm(true)
}
function cancel() {
  resolveConfirm(false)
}
</script>

<template>
  <div v-if="state.confirm.open" class="overlay confirm-overlay" @click.self="cancel">
    <div class="dialog confirm-dialog">
      <div class="dialog-head">
        <h3>{{ state.confirm.title }}</h3>
        <button class="icon-btn" title="关闭" @click="cancel"><Icon name="close" :size="16" /></button>
      </div>
      <div class="dialog-body">
        <div v-if="state.confirm.message" class="confirm-message">{{ state.confirm.message }}</div>
        <input
          v-if="state.confirm.input"
          v-model="state.confirm.input.value"
          class="input confirm-input"
          :placeholder="state.confirm.input.placeholder"
          @keyup.enter="ok"
        />
      </div>
      <div class="dialog-foot">
        <button class="btn ghost" @click="cancel">{{ state.confirm.cancelText }}</button>
        <button class="btn" :class="state.confirm.danger ? 'danger' : 'primary'" @click="ok">
          {{ state.confirm.confirmText }}
        </button>
      </div>
    </div>
  </div>
</template>
