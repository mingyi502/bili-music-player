<script setup>
/**
 * 通用底部动作面板（移动端优先，桌面端居中对话框）。
 * 用法：openActionSheet({ title, items: [{ icon, label, hint, danger, onClick }] })
 */
import Icon from './Icon.vue'
import { state, closeActionSheet } from '../store/index'

function run(item) {
  closeActionSheet()
  if (typeof item?.onClick === 'function') item.onClick()
}
</script>

<template>
  <div v-if="state.actionSheet.open" class="overlay action-sheet-overlay" @click.self="closeActionSheet">
    <div class="action-sheet">
      <div class="as-handle" aria-hidden="true"></div>
      <div v-if="state.actionSheet.title" class="as-title">{{ state.actionSheet.title }}</div>
      <div class="as-list">
        <button
          v-for="(item, i) in state.actionSheet.items"
          :key="i"
          class="as-item"
          :class="{ danger: item.danger }"
          @click="run(item)"
        >
          <Icon v-if="item.icon" :name="item.icon" :size="17" />
          <span class="as-label">{{ item.label }}</span>
          <span v-if="item.hint" class="as-hint">{{ item.hint }}</span>
        </button>
      </div>
      <button class="as-item as-cancel" @click="closeActionSheet">取消</button>
    </div>
  </div>
</template>
