<script setup>
import { computed, ref, watch } from 'vue'
import Icon from './Icon.vue'
import AppImage from './AppImage.vue'
import { state, searchInDialog, closeCandidateDialog, setMatch, songKey } from '../store/index'

const dlg = computed(() => state.candidateDialog)
const keyword = ref('')

watch(
  () => dlg.value.open,
  (v) => {
    if (v) keyword.value = dlg.value.keyword
  }
)

function fmtNum(n) {
  if (!n) return '0'
  if (n >= 100000000) return (n / 100000000).toFixed(1) + '亿'
  if (n >= 10000) return (n / 10000).toFixed(1) + '万'
  return String(n)
}

function choose(video) {
  const song = state.songs.find((s) => songKey(s) === dlg.value.songKey)
  if (song) setMatch(song, video)
  closeCandidateDialog()
}
</script>

<template>
  <div v-if="dlg.open" class="overlay" @click.self="closeCandidateDialog">
    <div class="dialog">
      <div class="dialog-head">
        <h3>为《{{ dlg.songName }}》选择 B 站视频</h3>
        <button class="icon-btn" @click="closeCandidateDialog"><Icon name="close" :size="16" /></button>
      </div>
      <div style="padding: 14px 18px 0; display: flex; gap: 8px">
        <input v-model="keyword" class="input" placeholder="搜索关键词" @keyup.enter="searchInDialog(keyword)" />
        <button class="btn bili" :disabled="dlg.loading" @click="searchInDialog(keyword)">
          <Icon :name="dlg.loading ? 'refresh' : 'search'" :size="15" :class="{ spin: dlg.loading }" /> 搜索
        </button>
      </div>
      <div class="dialog-body">
        <div v-if="dlg.loading" class="center-msg" style="height: 200px">
          <span class="spin"><Icon name="refresh" :size="30" /></span>
        </div>
        <div v-else-if="!dlg.list.length" class="center-msg" style="height: 200px">
          <div>没有搜索到结果，试试更换关键词</div>
        </div>
        <div v-else class="candidate-list">
          <div
            v-for="v in dlg.list"
            :key="v.bvid"
            class="candidate"
            @click="choose(v)"
          >
            <AppImage :src="v.cover" alt="" />
            <div class="c-text">
              <div class="c-title">{{ v.title }}</div>
              <div class="c-sub">UP：{{ v.author }} · {{ fmtNum(v.play) }} 播放 · {{ v.duration }}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
