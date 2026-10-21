<script setup>
import { ref, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Icon from './Icon.vue'
import AppImage from './AppImage.vue'
import {
  state,
  store,
  loadPlaylist,
  logout,
  showLiked,
  loadAlbum,
  closeSidebar,
  createPlaylist,
  deletePlaylist,
  importPlaylistFile,
} from '../store/index'

const emit = defineEmits(['open-settings', 'open-login'])
const link = ref('')
const importInput = ref(null)
const route = useRoute()
const router = useRouter()

/** 导入歌单文件（G5）：JSON / m3u → 创建新歌单 */
async function onImportFile(e) {
  const file = e?.target?.files?.[0]
  if (e?.target) e.target.value = ''
  if (file) await importPlaylistFile(file)
}

const likedSub = computed(() => {
  if (state.likedCount) return `${state.likedCount} 首`
  if (store.isLoggedIn.value && !state.musicLoaded) return '加载中…'
  return '0 首'
})

// 「我喜欢」的封面：QQ 歌单接口不返回，用第一首**有封面**的歌代替
// （不能直接用第 0 首：实测 647 首里有 8 首没有封面，会显示成空块）
const likedCover = computed(() => {
  const hit = state.likedSongs.find((s) => s.cover)
  return hit ? hit.cover.replace('150x150', '300x300') : ''
})

/** 已下载数量（P6，侧栏入口副标题） */
const downloadCount = computed(() => Object.values(state.downloads || {}).filter((r) => r?.status === 'done').length)

async function onLoadLink() {
  if (!link.value.trim()) return
  try {
    await loadPlaylist(link.value.trim())
    router.push('/')
    closeSidebar()
  } catch {
    /* toast 已提示 */
  }
}

/** 移动端：选中后自动收起抽屉 */
function pickPlaylist(id) {
  loadPlaylist(id)
  router.push('/')
  closeSidebar()
}
function pickLiked() {
  showLiked()
  router.push('/')
  closeSidebar()
}
function pickAlbum(album) {
  if (album.mid) router.push(`/album/${album.mid}`)
  else loadAlbum(album).then(() => router.push('/')).catch(() => {})
  closeSidebar()
}
function pickHistory() {
  router.push('/history')
  closeSidebar()
}
function go(path) {
  router.push(path)
  closeSidebar()
}

/** 新建歌单（P4.4）：输入弹窗 → 写接口 → 刷新侧栏 */
function onCreatePlaylist() {
  createPlaylist()
}

/** 删除歌单（P4.6）：二次确认 → 写接口 → 刷新侧栏 */
function onDeletePlaylist(pl) {
  deletePlaylist(pl.dirId, pl.name)
}
</script>

<template>
  <aside class="sidebar" :class="{ open: state.ui.sidebarOpen }">
    <div class="brand">
      <span class="logo"><Icon name="music" :size="16" /></span>
      <span>bili-music-player</span>
    </div>

    <div class="side-section">
      <div v-if="store.isLoggedIn.value" class="user-card">
        <AppImage class="user-avatar" :src="state.user.avatar" alt="" :lazy="false" />
        <div class="user-text">
          <div class="user-name">
            {{ state.user.nickname || 'QQ音乐用户' }}
            <span v-if="state.user.vip" class="badge manual">VIP</span>
          </div>
          <div class="user-uin">QQ {{ state.user.uin }}</div>
        </div>
        <button
          class="icon-btn"
          :class="{ 'diag-alert': store.failedChecks.value.length }"
          title="自检诊断"
          @click="state.diagnostics.open = true"
        >
          <Icon name="wand" :size="15" />
        </button>
        <button class="icon-btn" title="退出登录" @click="logout">
          <Icon name="logout" :size="15" />
        </button>
      </div>
      <div v-else class="login-entry">
        <button class="btn primary" style="flex: 1" @click="emit('open-login')">
          <Icon name="music" :size="16" /> 登录 QQ 音乐
        </button>
        <button class="icon-btn" title="自检诊断" @click="state.diagnostics.open = true">
          <Icon name="wand" :size="16" />
        </button>
        <button class="icon-btn" title="Cookie / 设置" @click="emit('open-settings')">
          <Icon name="settings" :size="16" />
        </button>
      </div>
    </div>

    <div class="side-section">
      <div class="side-label">
        <span>添加歌单</span>
        <button class="icon-btn" title="新建歌单" @click="onCreatePlaylist">
          <Icon name="plus" :size="14" />
        </button>
        <button class="icon-btn" title="导入歌单（JSON / m3u）" @click="importInput?.click()">
          <Icon name="external" :size="14" />
        </button>
      </div>
      <input
        ref="importInput"
        type="file"
        accept=".json,.m3u,.m3u8,application/json,audio/x-mpegurl"
        style="display: none"
        @change="onImportFile"
      />
      <div class="uin-row">
        <input v-model="link" class="input" placeholder="粘贴歌单链接 / 歌单ID" @keyup.enter="onLoadLink" />
        <button class="btn sm" :disabled="state.loading.playlist" @click="onLoadLink" title="加载歌单">
          <Icon :name="state.loading.playlist ? 'refresh' : 'playlist'" :size="14" :class="{ spin: state.loading.playlist }" />
        </button>
      </div>
      <div class="side-hint">
        歌单 ID 即链接中的数字（唯一），如
        <code>y.qq.com/n/ryqq/playlist/<b>7011264340</b></code>
      </div>
    </div>

    <div class="playlist-scroll">
      <div class="side-label" style="padding: 4px 16px">发现</div>
      <div
        class="playlist-item nav-item"
        :class="{ active: route.path === '/daily' }"
        @click="go('/daily')"
      >
        <div class="liked-cover"><Icon name="wand" :size="18" /></div>
        <div class="pi-text">
          <div class="pi-name">每日推荐</div>
          <div class="pi-sub">按口味生成 30 首</div>
        </div>
      </div>
      <div
        class="playlist-item nav-item"
        :class="{ active: route.path === '/fm' }"
        @click="go('/fm')"
      >
        <div class="liked-cover"><Icon name="shuffle" :size="18" /></div>
        <div class="pi-text">
          <div class="pi-name">私人 FM</div>
          <div class="pi-sub">连续播放 · 不重复</div>
        </div>
      </div>
      <div
        class="playlist-item nav-item"
        :class="{ active: route.path === '/search' }"
        @click="go('/search')"
      >
        <div class="liked-cover"><Icon name="search" :size="18" /></div>
        <div class="pi-text">
          <div class="pi-name">搜索</div>
          <div class="pi-sub">歌曲 / 专辑 / 歌单 / 歌手</div>
        </div>
      </div>
      <div
        class="playlist-item nav-item"
        :class="{ active: route.path === '/rank' }"
        @click="go('/rank')"
      >
        <div class="liked-cover"><Icon name="target" :size="18" /></div>
        <div class="pi-text">
          <div class="pi-name">排行榜</div>
          <div class="pi-sub">巅峰榜 / 地区 / 特色 / 全球</div>
        </div>
      </div>
      <div
        class="playlist-item nav-item"
        :class="{ active: route.path === '/square' }"
        @click="go('/square')"
      >
        <div class="liked-cover"><Icon name="playlist" :size="18" /></div>
        <div class="pi-text">
          <div class="pi-name">歌单广场</div>
          <div class="pi-sub">按语种 / 风格 / 场景挑歌单</div>
        </div>
      </div>

      <div class="side-label" style="padding: 12px 16px 4px">我的音乐</div>
      <div
        class="playlist-item history-item"
        :class="{ active: route.path === '/history' }"
        @click="pickHistory"
      >
        <div class="liked-cover"><Icon name="clock" :size="18" /></div>
        <div class="pi-text">
          <div class="pi-name">最近播放</div>
          <div class="pi-sub">{{ state.history.length ? `${state.history.length} 首` : '仅本机记录' }}</div>
        </div>
      </div>

      <div
        class="playlist-item history-item"
        :class="{ active: route.path === '/storage' }"
        @click="go('/storage')"
      >
        <div class="liked-cover"><Icon name="download" :size="18" /></div>
        <div class="pi-text">
          <div class="pi-name">下载与存储</div>
          <div class="pi-sub">{{ downloadCount ? `${downloadCount} 首已下载` : '下载 / 本地音乐' }}</div>
        </div>
      </div>

      <div
        class="playlist-item history-item"
        :class="{ active: route.path === '/report' }"
        @click="go('/report')"
      >
        <div class="liked-cover"><Icon name="chart" :size="18" /></div>
        <div class="pi-text">
          <div class="pi-name">听歌报告</div>
          <div class="pi-sub">{{ state.listenStats.length ? `${state.listenStats.length} 条记录` : '本地收听统计' }}</div>
        </div>
      </div>

      <template v-if="store.isLoggedIn.value">
        <div
          class="playlist-item liked-item"
          :class="{ active: route.path === '/' && state.playlist && state.playlist.id === 'liked' }"
          @click="pickLiked"
        >
          <AppImage v-if="likedCover" :src="likedCover" alt="" :lazy="false" placeholder />
          <div v-else class="liked-cover"><Icon name="music" :size="18" /></div>
          <div class="pi-text">
            <div class="pi-name">我喜欢的音乐</div>
            <div class="pi-sub">{{ likedSub }}</div>
          </div>
        </div>
      </template>

      <template v-if="state.albums.length">
        <div class="side-label" style="padding: 12px 16px 4px">
          收藏的专辑 ({{ state.albumTotal || state.albums.length }})
        </div>
        <div
          v-for="al in state.albums"
          :key="al.mid || al.id"
          class="playlist-item"
          :class="{ active: route.path.startsWith('/album/') && state.playlist && state.playlist.id === `album:${al.mid}` }"
          @click="pickAlbum(al)"
        >
          <AppImage :src="al.cover" alt="" placeholder />
          <div class="pi-text">
            <div class="pi-name">{{ al.name }}</div>
            <div class="pi-sub">
              {{ (al.singers || []).join(' / ') }}<span v-if="al.songCount"> · {{ al.songCount }} 首</span>
            </div>
          </div>
        </div>
      </template>

      <template v-if="state.playlists.length">
        <template v-if="store.createdPlaylists.value.length">
          <div class="side-label" style="padding: 4px 16px">创建的歌单 ({{ store.createdPlaylists.value.length }})</div>
          <div
            v-for="pl in store.createdPlaylists.value"
            :key="pl.id"
            class="playlist-item"
            :class="{ active: route.path === '/' && state.playlist && state.playlist.id === pl.id }"
            @click="pickPlaylist(pl.id)"
          >
            <AppImage :src="pl.cover" alt="" placeholder />
            <div class="pi-text">
              <div class="pi-name">{{ pl.name }}</div>
              <div class="pi-sub">{{ pl.songCount }} 首</div>
            </div>
            <button class="icon-btn pl-del" title="删除歌单" @click.stop="onDeletePlaylist(pl)">
              <Icon name="trash" :size="14" />
            </button>
          </div>
        </template>

        <template v-if="store.collectedPlaylists.value.length">
          <div class="side-label" style="padding: 14px 16px 4px">收藏的歌单 ({{ store.collectedPlaylists.value.length }})</div>
          <div
            v-for="pl in store.collectedPlaylists.value"
            :key="pl.id"
            class="playlist-item"
            :class="{ active: route.path === '/' && state.playlist && state.playlist.id === pl.id }"
            @click="pickPlaylist(pl.id)"
          >
            <AppImage :src="pl.cover" alt="" placeholder />
            <div class="pi-text">
              <div class="pi-name">{{ pl.name }}</div>
              <div class="pi-sub">{{ pl.songCount }} 首</div>
            </div>
          </div>
        </template>
      </template>
      <div v-if="!state.playlists.length && !state.albums.length && !store.isLoggedIn.value" class="empty-hint">
        点击「登录 QQ 音乐」扫码，自动导入你的歌单。<br />
        也可以粘贴歌单链接 / 歌单 ID 添加。
      </div>
      <div v-if="!state.playlists.length && !state.albums.length && store.isLoggedIn.value" class="empty-hint">
        未读取到歌单或专辑。可点击上方用户卡片里的「魔杖」按钮自检原因。
      </div>
    </div>
  </aside>
</template>
