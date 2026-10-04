<script setup>
import { computed, onMounted, ref } from 'vue'
import Icon from '../components/Icon.vue'
import AppImage from '../components/AppImage.vue'
import { state, hasDownloads, downloadBackend, playLocalQueue, removeDownload, clearAllDownloads, retryFailedDownloads, importLocalFiles, removeLocalMusic, localMusicSongs } from '../store/index'
import { formatBytes, downloadStats } from '../api/downloads.js'
import { clearImageCache } from '../utils/mediaCache.js'
import { toast, askConfirm } from '../store/index'

const stats = computed(() => downloadStats(state.downloads))
const doneList = computed(() => Object.values(state.downloads).filter((r) => r?.status === 'done'))
const running = computed(() => state.downloadQueue.filter((x) => x.status === 'pending' || x.status === 'running'))
const failed = computed(() => state.downloadQueue.filter((x) => x.status === 'failed'))
const localSize = computed(() => state.localMusic.reduce((s, m) => s + (Number(m.size) || 0), 0))
const cacheSize = ref(0)

async function refreshCacheSize() {
  const be = downloadBackend()
  if (!be) return
  try {
    cacheSize.value = await be.audioCacheSize()
  } catch {
    cacheSize.value = 0
  }
}
onMounted(refreshCacheSize)

function playDownloaded(index = 0) {
  const songs = doneList.value.map((r) => ({ ...(r.song || {}), localUri: r.uri, downloaded: true }))
  if (songs.length) playLocalQueue(songs, index)
}
function playLocal(index) {
  playLocalQueue(localMusicSongs(), index)
}
async function onClearAudioCache() {
  const ok = await askConfirm({
    title: '清空音频缓存',
    message: `将清空播放产生的临时音频缓存（${formatBytes(cacheSize.value)}）；已下载歌曲不受影响。`,
    confirmText: '清空',
    danger: true,
  })
  if (!ok) return
  await downloadBackend()?.clearAudioCache?.()
  await refreshCacheSize()
  toast('已清空音频缓存', 'success')
}
function onClearImageCache() {
  clearImageCache()
  toast('已清空图片缓存（内存）', 'success')
}
async function onImport(e) {
  const files = e.target?.files
  await importLocalFiles(files)
  e.target.value = ''
}
</script>

<template>
  <div class="storage-view">
    <div class="st-head">
      <div class="st-title"><Icon name="download" :size="18" /> 下载与存储</div>
      <div class="st-sub">
        已下载 {{ stats.count }} 首 · {{ formatBytes(stats.size) }}<span v-if="stats.failed"> · 失败 {{ stats.failed }}</span>
      </div>
    </div>

    <div v-if="!hasDownloads()" class="center-msg">
      <div>
        <div class="big"><Icon name="download" :size="46" /></div>
        <div>下载 / 本地导入仅 App 支持</div>
        <div style="margin-top: 6px">Web 端可清空图片缓存</div>
        <button class="btn ghost sm" style="margin-top: 12px" @click="onClearImageCache">清空图片缓存</button>
      </div>
    </div>

    <template v-else>
      <!-- 下载队列 -->
      <div v-if="running.length || failed.length" class="st-section">
        <div class="st-section-title">
          下载队列
          <span v-if="running.length" class="st-badge">进行中 {{ running.length }}</span>
          <span v-if="failed.length" class="st-badge danger">失败 {{ failed.length }}</span>
          <button v-if="failed.length" class="btn ghost sm" style="margin-left: 8px" @click="retryFailedDownloads">重试失败</button>
        </div>
        <div v-for="item in state.downloadQueue" :key="item.key" class="st-row">
          <div class="st-main">
            <div class="st-name">{{ item.song?.name }}</div>
            <div class="st-meta">{{ item.song?.singers?.join(' / ') || '未知歌手' }}</div>
          </div>
          <div class="st-state">
            <span v-if="item.status === 'done'" class="st-badge ok">完成</span>
            <span v-else-if="item.status === 'failed'" class="st-badge danger">失败</span>
            <span v-else class="st-badge"><Icon name="refresh" :size="12" class="spin" /> {{ item.status === 'pending' ? '等待' : '下载中' }}</span>
          </div>
        </div>
      </div>

      <!-- 已下载 -->
      <div class="st-section">
        <div class="st-section-title">
          已下载（{{ doneList.length }} · {{ formatBytes(stats.size) }}）
          <button class="btn ghost sm" :disabled="!doneList.length" @click="playDownloaded(0)">播放全部</button>
          <button class="btn ghost sm" :disabled="!doneList.length" @click="clearAllDownloads">清空</button>
        </div>
        <div v-if="doneList.length" class="st-list">
          <div v-for="(r, i) in doneList" :key="r.key" class="st-row clickable" @click="playDownloaded(i)">
            <AppImage class="st-cover" :src="r.song?.cover" alt="" placeholder />
            <div class="st-main">
              <div class="st-name">{{ r.song?.name }}</div>
              <div class="st-meta">
                {{ r.song?.singers?.join(' / ') || '未知歌手' }} · {{ formatBytes(r.size) }} · {{ r.source === 'qq' ? 'QQ音源' : 'B站音源' }}
              </div>
            </div>
            <div class="st-actions" @click.stop>
              <button class="icon-btn" title="删除下载" @click="removeDownload(r.song)"><Icon name="trash" :size="15" /></button>
            </div>
          </div>
        </div>
        <div v-else class="st-empty">还没有下载的歌曲（在歌曲行或播放器点下载）</div>
      </div>

      <!-- 本地音乐 -->
      <div class="st-section">
        <div class="st-section-title">
          本地音乐（{{ state.localMusic.length }} · {{ formatBytes(localSize) }}）
          <label class="btn ghost sm st-import">
            <Icon name="plus" :size="14" /> 导入文件
            <input type="file" accept="audio/*" multiple hidden @change="onImport" />
          </label>
        </div>
        <div v-if="state.localMusic.length" class="st-list">
          <div v-for="(m, i) in state.localMusic" :key="m.key" class="st-row clickable" @click="playLocal(i)">
            <div class="st-cover st-cover-ph"><Icon name="music" :size="18" /></div>
            <div class="st-main">
              <div class="st-name">{{ m.name }}</div>
              <div class="st-meta">{{ m.singers?.join(' / ') || '未知歌手' }} · {{ formatBytes(m.size) }}</div>
            </div>
            <div class="st-actions" @click.stop>
              <button class="icon-btn" title="移除" @click="removeLocalMusic(m)"><Icon name="trash" :size="15" /></button>
            </div>
          </div>
        </div>
        <div v-else class="st-empty">从本机选择音频文件导入（「歌手 - 歌名.mp3」会自动识别歌手）</div>
      </div>

      <!-- 缓存清理 -->
      <div class="st-section">
        <div class="st-section-title">缓存</div>
        <div class="st-row">
          <div class="st-main">
            <div class="st-name">音频缓存（播放临时文件）</div>
            <div class="st-meta">{{ formatBytes(cacheSize) }} · 可随时清理，不影响已下载歌曲</div>
          </div>
          <div class="st-actions">
            <button class="btn ghost sm" :disabled="!cacheSize" @click="onClearAudioCache">清空</button>
          </div>
        </div>
        <div class="st-row">
          <div class="st-main">
            <div class="st-name">图片缓存（内存）</div>
            <div class="st-meta">封面解析结果，重启自动释放</div>
          </div>
          <div class="st-actions">
            <button class="btn ghost sm" @click="onClearImageCache">清空</button>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
