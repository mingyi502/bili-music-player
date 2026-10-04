<script setup>
import { ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import Icon from './Icon.vue'
import AppImage from './AppImage.vue'
import { state, saveConfig, toast, loginWithCookie, logout, toggleDesktopLyric, refreshDesktopLyricPermission, saveCurrentAccount, switchAccount, removeAccount, isLoggedIn, setTheme } from '../store/index'
import { hasMediaControl } from '../core/mediaControl.js'
import { fetchFollowedSingers } from '../api/qq/follow.js'
import { SHOW_EXPERIMENTAL } from '../core/build.js'

const props = defineProps({ open: Boolean })
const emit = defineEmits(['close'])
const router = useRouter()

/** 桌面歌词 / 通知栏控制仅 App 有（Web 隐藏入口） */
const nativeMedia = hasMediaControl()

const qqCookie = ref(state.config.qqCookie || '')
const biliCookie = ref(state.config.biliCookie || '')
const defaultSource = ref(state.config.defaultSource || 'bili')
const webLoginOneKey = ref(Boolean(state.config.webLoginOneKey))
const theme = ref(state.config.theme || 'system')

/** 主题（H1）：切换立即生效并持久化 */
function onThemeChange() {
  setTheme(theme.value)
}

const version = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev'
const isRelease = typeof __APP_RELEASE__ !== 'undefined' && __APP_RELEASE__
const showExperimental = SHOW_EXPERIMENTAL && !isRelease
const buildTime = typeof __APP_BUILD__ !== 'undefined' ? new Date(__APP_BUILD__).toLocaleString() : 'dev'

// 关注的歌手（P5 E5 可行部分，只读；按需加载避免每次打开弹窗都发请求）
const followed = ref([])
const followLoading = ref(false)
const followError = ref('')

async function loadFollowed() {
  if (followLoading.value) return
  followLoading.value = true
  followError.value = ''
  try {
    const res = await fetchFollowedSingers({
      euin: state.config.euin,
      uin: state.config.uin,
      cookie: state.config.qqCookie,
      size: 20,
    })
    followed.value = res.list
    if (!res.list.length) followError.value = '没有关注的歌手（或账号未同步）'
  } catch (e) {
    followError.value = e?.message || '加载失败'
  } finally {
    followLoading.value = false
  }
}

function openArtist(s) {
  emit('close')
  router.push(`/artist/${s.mid}`)
}

watch(
  () => props.open,
  (v) => {
    if (v) {
      qqCookie.value = state.config.qqCookie || ''
      biliCookie.value = state.config.biliCookie || ''
      defaultSource.value = state.config.defaultSource || 'bili'
      webLoginOneKey.value = Boolean(state.config.webLoginOneKey)
      theme.value = state.config.theme || 'system'
      if (nativeMedia) refreshDesktopLyricPermission()
    }
  }
)

async function onToggleDesktopLyric() {
  await toggleDesktopLyric()
}

/** 账号切换（G3）：切换成功后同步本地输入框，避免「保存」把旧 Cookie 写回去 */
async function onSwitchAccount(acc) {
  const ok = await switchAccount(acc.id)
  if (ok) {
    qqCookie.value = state.config.qqCookie || ''
    biliCookie.value = state.config.biliCookie || ''
  }
}

async function onRemoveAccount(acc) {
  await removeAccount(acc.id)
}

async function save() {
  const nextQq = qqCookie.value.trim()
  const prevQq = state.config.qqCookie || ''
  saveConfig({
    biliCookie: biliCookie.value.trim(),
    defaultSource: defaultSource.value === 'qq' ? 'qq' : 'bili',
    // Do not carry an old experimental setting into a normal/release build.
    webLoginOneKey: showExperimental ? Boolean(webLoginOneKey.value) : false,
  })
  emit('close')
  if (nextQq !== prevQq) {
    if (nextQq) {
      // 手动 Cookie 登录：会解析 uin、建立登录态并导入歌单
      await loginWithCookie(nextQq)
    } else {
      await logout()
    }
  } else {
    toast('设置已保存', 'success')
  }
}
</script>

<template>
  <div v-if="open" class="overlay" @click.self="emit('close')">
    <div class="dialog">
      <div class="dialog-head">
        <h3>设置</h3>
        <button class="icon-btn" @click="emit('close')"><Icon name="close" :size="16" /></button>
      </div>
      <div class="dialog-body">
        <div class="field">
          <label>QQ 音乐 Cookie（手动登录，扫码失败时的备用方案）</label>
          <textarea v-model="qqCookie" placeholder="uin=xxxx; qm_keyst=xxxx; qqmusic_key=xxxx; ..." />
          <div class="hint">
            优先使用左侧「登录 QQ 音乐」扫码。若扫码不可用，可在浏览器登录 y.qq.com 后打开开发者工具 →
            Network，任选一个 c.y.qq.com 请求，复制其 Request Headers 中的 Cookie 整段粘贴。留空则仅能读取公开歌单。
          </div>
        </div>
        <div class="field">
          <label>哔哩哔哩 Cookie（可选，用于提升搜索成功率）</label>
          <textarea v-model="biliCookie" placeholder="SESSDATA=xxxx; bili_jct=xxxx; ..." />
          <div class="hint">
            登录 bilibili.com 后复制 Cookie。当搜索接口提示触发风控（-412）时配置此项可显著改善。
          </div>
        </div>
        <div class="field">
          <label>主题（H1）</label>
          <select v-model="theme" class="input" @change="onThemeChange">
            <option value="system">跟随系统</option>
            <option value="light">亮色</option>
            <option value="dark">暗色</option>
          </select>
          <div class="hint">切换立即生效并记住；「跟随系统」会随系统的深浅色设置自动切换。</div>
        </div>
        <div class="field">
          <label>默认播放音源</label>
          <select v-model="defaultSource" class="input">
            <option value="bili">B站音源（默认，较稳定）</option>
            <option value="qq">QQ音乐音源（VIP/版权限制时可能不可用）</option>
          </select>
          <div class="hint">
            只影响「没有单独设过音源」的歌曲；在播放器上切换某首歌的音源会被单独记住。
            默认音源为 B站时，未匹配的歌曲会**自动匹配**；匹配不到会提示，而不会自动改用 QQ。
          </div>
        </div>
        <div v-if="showExperimental" class="field">
          <label class="switch-line">
            <input v-model="webLoginOneKey" type="checkbox" />
            实验（已证实不可行）：网页登录时允许「一键登录」
          </label>
          <div class="hint">
            <b>源码级结论</b>：腾讯的「一键登录」只在 <b>QQ浏览器 / X5 内核浏览器 / 微信内置浏览器</b>
            里能成功 —— 它们提供 JS bridge，把 <code>uin</code>+<code>loginkey</code> 直接交给页面，
            全程不出页面。其它浏览器（含本应用）只能唤起手机 QQ，而结果要由 QQ 把 https 回调交给
            <b>系统浏览器</b>，本应用收不到。
            <br />
            保持关闭即可；扫码 / 网页登录 / 手动 Cookie 均不受影响。
          </div>
        </div>
        <div class="field account-field">
          <label>账号切换（本机保存的登录，最多 5 个）</label>
          <div class="acc-list">
            <div
              v-for="acc in state.accounts"
              :key="acc.id"
              class="acc-row"
              :class="{ current: acc.uin === state.config.uin }"
            >
              <div class="acc-main">
                <div class="acc-name">
                  {{ acc.nickname }} <span class="acc-uin">QQ {{ acc.uin }}</span>
                </div>
                <div class="acc-sub">{{ acc.uin === state.config.uin ? '当前账号' : '已保存' }}</div>
              </div>
              <button v-if="acc.uin !== state.config.uin" class="btn ghost sm" @click="onSwitchAccount(acc)">切换</button>
              <button class="btn ghost sm danger-text" title="从本机移除" @click="onRemoveAccount(acc)">删除</button>
            </div>
            <div v-if="!state.accounts.length" class="hint">还没有保存的账号。登录后点下方「保存当前账号」即可一键切换。</div>
          </div>
          <button class="btn ghost sm" :disabled="!isLoggedIn" @click="saveCurrentAccount()">
            <Icon name="plus" :size="14" /> 保存当前账号
          </button>
          <div class="hint">切换账号会停止播放并重新加载歌单；凭证只保存在本机。</div>
        </div>
        <div v-if="isLoggedIn" class="field">
          <label>关注的歌手（只读）</label>
          <button v-if="!followed.length && !followLoading" class="btn ghost sm" @click="loadFollowed">
            <Icon name="refresh" :size="14" /> 加载关注的歌手
          </button>
          <div v-if="followLoading" class="hint">正在加载…</div>
          <div v-else-if="followError" class="hint">{{ followError }}</div>
          <div v-else-if="followed.length" class="follow-list">
            <button v-for="s in followed" :key="s.mid" class="follow-item" :title="s.name" @click="openArtist(s)">
              <AppImage class="follow-avatar" :src="s.avatar" alt="" placeholder />
              <span class="follow-name">{{ s.name }}</span>
            </button>
          </div>
          <div class="hint">好友动态接口不可用（code 1001），关注/取关无写方法；这里只能看已关注的歌手。</div>
        </div>
        <div v-if="nativeMedia" class="field desktop-lyric-row">
          <label>桌面歌词（仅 App）</label>
          <button class="btn" :class="state.desktopLyric.enabled ? 'primary' : 'ghost'" @click="onToggleDesktopLyric">
            <Icon name="lyrics" :size="15" />
            {{ state.desktopLyric.enabled ? '已开启（点此关闭）' : '开启桌面歌词' }}
          </button>
          <div class="hint">
            在系统悬浮窗显示当前歌词行（含翻译，可拖动）；首次开启需在系统设置里允许「显示在其他应用上层」。
          </div>
        </div>
        <div class="app-version">
          版本 v{{ version }}<span v-if="!isRelease"> · 构建 {{ buildTime }}</span>
          <div class="hint" style="margin-top: 4px">
            <span v-if="!isRelease">若这里的时间比你刚改的代码旧，说明页面还是旧版本，请强制刷新（Ctrl+F5 / 下拉刷新）。</span>
          </div>
        </div>
      </div>
      <div class="dialog-foot">
        <button class="btn ghost" @click="emit('close')">取消</button>
        <button class="btn primary" @click="save"><Icon name="check" :size="15" /> 保存</button>
      </div>
    </div>
  </div>
</template>
