<script setup>
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import Icon from './Icon.vue'
import { startQrLogin, pollQrLogin, closeQrSession, supportsWebLogin, webLoginPage } from '../api/auth'
import { loginWithSession, loginWithCookie, toast, state } from '../store/index'
import { parseUinFromCookie } from '../api/qq'
import { buildBookmarklet, normalizePastedCookie, cookieHasLogin } from '../utils/cookieImport'
import {
  POLL_RETRY_MAX,
  START_RETRY_MAX,
  startRetryDelay,
  pollRetryMessage,
  friendlyLoginError,
} from '../utils/loginRetry'
import { readClipboard, writeClipboard } from '../core/clipboard'
import { SHOW_EXPERIMENTAL } from '../core/build.js'

const props = defineProps({ open: Boolean })
const emit = defineEmits(['close', 'open-settings'])

/** 登录方式：qr 扫码（默认） / web 打开腾讯登录页（仅 App） / cookie 手动粘贴 */
const mode = ref('qr')
const tabs = computed(() => {
  const list = [{ key: 'qr', label: '扫码登录' }]
  if (supportsWebLogin()) list.push({ key: 'web', label: '网页登录' })
  list.push({ key: 'cookie', label: '手动 Cookie' })
  return list
})

// ── 扫码登录状态 ───────────────────────────────────────────────
const image = ref('')
const status = ref('loading')
const message = ref('')
const canFallback = ref(false)
const diag = ref(null)
const copied = ref(false)
let timer = null
let busy = false
// 轮询连续失败计数：网络抖动不再「一错即停」，超过上限才落错误态（F1）
let failCount = 0

const diagText = computed(() => (diag.value ? JSON.stringify(diag.value, null, 2) : ''))

// ── 网页登录状态 ───────────────────────────────────────────────
const webBusy = ref(false)
const isRelease = typeof __APP_RELEASE__ !== 'undefined' && __APP_RELEASE__
const showExperimental = SHOW_EXPERIMENTAL && !isRelease
const webMsg = ref('')
// 网页登录失败时的诊断信息（最终地址 / Cookie 名单 / 跳转轨迹）
const webDiag = ref(null)

// ── 手动 Cookie 状态 ───────────────────────────────────────────
const cookieText = ref('')
const cookieBusy = ref(false)
const clipBusy = ref(false)
const bmCopied = ref(false)
// 始终渲染出来，剪贴板不可用时用户可手动全选复制
const bookmarklet = buildBookmarklet()

/** 从剪贴板读取并清洗 Cookie（移动端浏览器没有 F12，靠书签小工具复制） */
async function pasteFromClipboard(silent = false) {
  clipBusy.value = true
  try {
    const text = await readClipboard()
    if (!text || !text.trim()) throw new Error('剪贴板是空的')
    const cleaned = normalizePastedCookie(text)
    if (!cookieHasLogin(cleaned)) {
      if (!silent) toast('剪贴板里没有 qm_keyst / qqmusic_key，可能不是 QQ 音乐 Cookie', 'error')
      return false
    }
    if (cleaned === cookieText.value) return false
    cookieText.value = cleaned
    toast(silent ? '已自动从剪贴板填入 Cookie，点下方按钮登录' : '已从剪贴板填入', 'success')
    return true
  } catch (e) {
    if (!silent) toast(`读取剪贴板失败：${e?.message || e}，请长按输入框手动粘贴`, 'error')
    return false
  } finally {
    clipBusy.value = false
  }
}

/**
 * App 回到前台时自动拾取剪贴板里的 QQ 音乐 Cookie。
 * 场景：手机上点一下浏览器书签（已复制 Cookie）→ 切回本应用 → 自动填好，只需点一次登录。
 */
async function autoPickClipboard() {
  if (!props.open || mode.value !== 'cookie') return
  if (document.visibilityState !== 'visible') return
  await pasteFromClipboard(true)
}

/** 复制书签小工具代码（存成浏览器书签后，在 y.qq.com 上点一下即可复制 Cookie） */
async function copyBookmarklet() {
  try {
    await writeClipboard(bookmarklet)
    bmCopied.value = true
    setTimeout(() => (bmCopied.value = false), 1800)
  } catch {
    toast('剪贴板不可用，请在下方文本框里长按全选复制', 'error')
  }
}

async function copyDiag() {
  try {
    await navigator.clipboard.writeText(diagText.value)
    copied.value = true
    setTimeout(() => (copied.value = false), 1500)
  } catch {
    toast('复制失败，请手动选择文本复制', 'error')
  }
}

function stop() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

/** 停止轮询并关闭服务端会话（避免会话在服务端无限堆积） */
function cleanup() {
  stop()
  failCount = 0
  closeQrSession()
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 生成二维码：失败自动重试（F2），仍失败则给出友好中文提示与降级入口 */
async function refresh() {
  cleanup()
  image.value = ''
  status.value = 'loading'
  message.value = '正在生成二维码…'
  canFallback.value = false
  diag.value = null
  for (let attempt = 1; attempt <= START_RETRY_MAX; attempt++) {
    if (!props.open || mode.value !== 'qr') return
    try {
      const img = await startQrLogin()
      if (!props.open || mode.value !== 'qr') {
        closeQrSession()
        return
      }
      image.value = img
      status.value = 'waiting'
      message.value = '请使用手机 QQ 扫码，并在手机上确认'
      timer = setInterval(tick, 1500)
      return
    } catch (e) {
      if (!props.open || mode.value !== 'qr') return
      if (attempt < START_RETRY_MAX) {
        message.value = `二维码生成失败，正在重试（${attempt}/${START_RETRY_MAX - 1}）…`
        await sleep(startRetryDelay(attempt))
        continue
      }
      status.value = 'error'
      message.value = friendlyLoginError(e, '二维码获取失败')
      canFallback.value = true
    }
  }
}

/**
 * 轮询失败处理（F1）：多为网络抖动 / 上游 5xx，保持等待扫码状态自动重试；
 * 连续失败超过上限才落错误态并提供刷新 / 降级入口。
 */
function handlePollFailure(raw) {
  if (status.value !== 'waiting' && status.value !== 'scanned') {
    // 非等待阶段（例如登录成功后导入歌单失败）→ 直接报错，不做轮询重试
    status.value = 'error'
    message.value = friendlyLoginError(raw)
    canFallback.value = true
    stop()
    return
  }
  failCount += 1
  if (failCount <= POLL_RETRY_MAX) {
    message.value = pollRetryMessage(failCount, POLL_RETRY_MAX)
    return
  }
  status.value = 'error'
  message.value = friendlyLoginError(raw, '登录服务暂时不可用，请刷新二维码重试')
  canFallback.value = true
  stop()
}

async function tick() {
  if (busy) return
  if (status.value !== 'waiting' && status.value !== 'scanned') return
  busy = true
  try {
    const r = await pollQrLogin()
    if (!props.open) return
    if (r.status === 'success') {
      failCount = 0
      stop()
      status.value = 'success'
      message.value = '登录成功，正在导入歌单…'
      await loginWithSession(r)
      emit('close')
      return
    }
    if (r.diag) diag.value = r.diag
    if (r.fallback) canFallback.value = true
    if (r.status === 'waiting' || r.status === 'scanned') {
      failCount = 0
      status.value = r.status
      message.value = r.message || ''
      return
    }
    if (r.status === 'expired') {
      status.value = 'expired'
      message.value = r.message || ''
      stop()
      return
    }
    if (r.fallback || r.diag) {
      // 已扫码但兑换票据失败：会话已失效，重试无意义，直接给错误与诊断
      status.value = 'error'
      message.value = r.message || '登录失败'
      stop()
      return
    }
    // 其它 error（登录接口异常 / 5xx）：按网络抖动处理
    handlePollFailure(r.message)
  } catch (e) {
    if (props.open) handlePollFailure(e?.message || e)
  } finally {
    busy = false
  }
}

/**
 * 回到前台补轮询（F3）：App 被系统冻结期间 interval 可能完全没有触发，
 * 回前台先立即补一次；若此前因连续失败已停止轮询，重置计数再试一轮。
 */
function resumeQrPolling() {
  if (!props.open || mode.value !== 'qr') return
  if (document.visibilityState === 'hidden') return
  if (status.value === 'waiting' || status.value === 'scanned') {
    tick()
    return
  }
  if (status.value === 'error' && image.value) {
    failCount = 0
    status.value = 'waiting'
    message.value = '已回到前台，正在重新连接…'
    if (!timer) timer = setInterval(tick, 1500)
    tick()
  }
}

/** 打开腾讯官方登录页；必须检测到音乐票据才建立登录态 */
async function doWebLogin() {
  if (webBusy.value) return
  webBusy.value = true
  webDiag.value = null
  webMsg.value = '正在打开 QQ 登录页…'
  try {
    const r = await webLoginPage({ allowOneKey: showExperimental && Boolean(state.config.webLoginOneKey) })
    if (!r.cookie) throw new Error('没有取到 Cookie，可能登录未完成')

    // 关键：没有 qm_keyst 说明兑换还没发生，此时建立登录态会得到一个「半登录」状态
    if (!r.hasMusicKey) {
      webDiag.value = {
        finalUrl: r.url,
        cookieNames: r.cookieNames,
        jumpUrl: r.jumpUrl,
        navLog: r.navLog,
      }
      throw new Error(
        '未检测到 QQ 音乐登录票据（qm_keyst），登录可能没走完。' +
          '请回到登录页完成扫码/密码确认，等待自动返回；或改用扫码登录。'
      )
    }

    webMsg.value = '登录成功，正在导入歌单…'
    await loginWithSession({
      cookie: r.cookie,
      uin: parseUinFromCookie(r.cookie),
      method: 'web',
      webInfo: { finalUrl: r.url, jumpUrl: r.jumpUrl, cookieNames: r.cookieNames },
    })
    emit('close')
  } catch (e) {
    webMsg.value = e?.message || '网页登录失败'
  } finally {
    webBusy.value = false
  }
}

/** 手动粘贴 Cookie 登录 */
async function doCookieLogin() {
  const text = normalizePastedCookie(cookieText.value)
  if (!text) {
    toast('请先粘贴 Cookie', 'error')
    return
  }
  if (!cookieHasLogin(text)) {
    toast('这段 Cookie 里没有 qm_keyst / qqmusic_key，无法登录', 'error')
    return
  }
  cookieBusy.value = true
  try {
    cleanup()
    await loginWithCookie(text)
    emit('close')
  } finally {
    cookieBusy.value = false
  }
}

function switchMode(next) {
  if (next === mode.value) return
  if (mode.value === 'qr') cleanup()
  mode.value = next
  if (next === 'qr' && !image.value) refresh()
  // 切到手动 Cookie 时，顺手看看剪贴板里有没有已经复制好的 Cookie
  if (next === 'cookie') autoPickClipboard()
}

function close() {
  cleanup()
  emit('close')
}

watch(
  () => props.open,
  (v) => {
    if (v) {
      cookieText.value = ''
      webMsg.value = ''
      webDiag.value = null
      mode.value = 'qr'
      refresh()
    } else {
      cleanup()
    }
  }
)
// App 回到前台（例如从浏览器/后台切回来）：自动拾取剪贴板 + 补一次扫码轮询
function onVisibilityChange() {
  autoPickClipboard()
  resumeQrPolling()
}
document.addEventListener('visibilitychange', onVisibilityChange)
onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', onVisibilityChange)
  cleanup()
})
</script>

<template>
  <div v-if="open" class="overlay" @click.self="close">
    <div class="dialog login-dialog">
      <div class="dialog-head">
        <h3>登录 QQ 音乐</h3>
        <button class="icon-btn" @click="close"><Icon name="close" :size="16" /></button>
      </div>

      <div class="login-tabs">
        <button
          v-for="t in tabs"
          :key="t.key"
          class="login-tab"
          :class="{ on: mode === t.key }"
          @click="switchMode(t.key)"
        >
          {{ t.label }}
        </button>
      </div>

      <div class="login-body">
        <!-- 扫码登录 -->
        <template v-if="mode === 'qr'">
          <div class="qr-box">
            <img v-if="image" :src="image" alt="登录二维码" class="qr-img" />
            <div v-else class="qr-placeholder">
              <span class="spin"><Icon name="refresh" :size="28" /></span>
            </div>

            <div v-if="status === 'scanned'" class="qr-mask">
              <Icon name="check" :size="34" />
              <span>已扫码，请在手机上确认</span>
            </div>
            <div v-else-if="status === 'expired' || status === 'error'" class="qr-mask">
              <Icon name="refresh" :size="30" />
              <span>{{ status === 'expired' ? '二维码已失效' : '出错了' }}</span>
            </div>
          </div>

          <div class="login-info">
            <div class="login-status" :class="status">
              <span v-if="status === 'loading' || status === 'scanned' || status === 'success'" class="spin">
                <Icon name="refresh" :size="13" />
              </span>
              {{ message }}
            </div>
            <ol class="login-steps">
              <li>打开手机 QQ（微信暂不支持）扫一扫</li>
              <li>在手机上确认授权登录</li>
              <li>登录成功后自动导入你的歌单</li>
            </ol>
            <div class="hint" style="margin-bottom: 10px">
              <b>只有一台手机？</b>先截屏保存这个二维码，再打开手机 QQ →「扫一扫」→ 右上角相册 → 选刚才的截图。
            </div>
            <div style="display: flex; gap: 8px; flex-wrap: wrap">
              <button class="btn" @click="refresh">
                <Icon name="refresh" :size="15" /> 刷新二维码
              </button>
              <button v-if="canFallback || supportsWebLogin()" class="btn primary" @click="switchMode(supportsWebLogin() ? 'web' : 'cookie')">
                <Icon :name="supportsWebLogin() ? 'external' : 'settings'" :size="15" />
                {{ supportsWebLogin() ? '改用网页登录' : '改用手动 Cookie 登录' }}
              </button>
            </div>
          </div>
        </template>

        <!-- 网页登录：打开腾讯官方登录页 -->
        <template v-else-if="mode === 'web'">
          <div class="login-info" style="text-align: left">
            <div class="login-status" :class="webBusy ? 'loading' : ''">
              <span v-if="webBusy" class="spin"><Icon name="refresh" :size="13" /></span>
              {{ webMsg || '将打开腾讯官方登录页，支持扫码、密码、验证码等方式' }}
            </div>
            <ol class="login-steps">
              <li>点击下方按钮打开 QQ 登录页</li>
              <li>在页面上任意方式完成登录（该页面由腾讯提供）</li>
              <li>登录成功后自动返回并导入你的歌单</li>
            </ol>
            <button class="btn primary" :disabled="webBusy" @click="doWebLogin">
              <Icon :name="webBusy ? 'refresh' : 'external'" :size="15" :class="{ spin: webBusy }" />
              {{ webBusy ? '等待登录…' : '打开 QQ 登录页' }}
            </button>
            <div class="hint" style="margin-top: 10px">
              登录在腾讯官方页面进行，本应用只在本机保存登录结果；不会获取你的账号密码。
            </div>
            <details v-if="webDiag" class="diag">
              <summary>诊断信息（可复制用于反馈）</summary>
              <pre class="diag-pre">{{ JSON.stringify(webDiag, null, 2) }}</pre>
            </details>
          </div>
        </template>

        <!-- 手动粘贴 Cookie -->
        <template v-else>
          <div class="login-info" style="text-align: left">
            <div class="field">
              <label>粘贴 QQ 音乐 Cookie</label>
              <textarea v-model="cookieText" placeholder="uin=xxxx; qqmusic_key=xxxx; qm_keyst=xxxx; ..." />
              <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px">
                <button class="btn" :disabled="clipBusy" @click="pasteFromClipboard">
                  <Icon name="link" :size="15" /> {{ clipBusy ? '读取中…' : '从剪贴板粘贴' }}
                </button>
                <button class="btn" @click="copyBookmarklet">
                  <Icon :name="bmCopied ? 'check' : 'link'" :size="15" />
                  {{ bmCopied ? '书签代码已复制' : '复制书签小工具代码' }}
                </button>
              </div>
              <div class="hint" style="margin-top: 10px">
                <b>电脑（最简单）</b>：浏览器登录 y.qq.com → F12 → Network → 任选一个 c.y.qq.com 请求 →
                复制 Request Headers 里的整段 Cookie → 粘贴到这里。
                <br />
                <b>手机</b>：把下面那段「书签小工具代码」存成浏览器书签；在浏览器里登录 y.qq.com 后点一下该书签，
                它会自动把 Cookie 复制到剪贴板，再回到本页点「从剪贴板粘贴」。
              </div>
              <details class="diag" style="width: 100%">
                <summary>书签小工具代码（点上方按钮复制，或在此手动全选复制）</summary>
                <textarea class="bm-code" readonly :value="bookmarklet" @focus="$event.target.select()" />
              </details>
            </div>
            <div style="display: flex; gap: 8px; flex-wrap: wrap">
              <button class="btn primary" :disabled="cookieBusy" @click="doCookieLogin">
                <Icon name="check" :size="15" /> 使用该 Cookie 登录
              </button>
              <button class="btn" @click="emit('open-settings')">
                <Icon name="settings" :size="15" /> 更多设置
              </button>
            </div>
          </div>
        </template>

        <details v-if="mode === 'qr' && diagText" class="diag">
          <summary>诊断信息（可复制用于反馈）</summary>
          <div class="diag-bar">
            <button class="btn sm" @click="copyDiag">
              <Icon :name="copied ? 'check' : 'link'" :size="13" /> {{ copied ? '已复制' : '复制诊断信息' }}
            </button>
          </div>
          <pre class="diag-pre">{{ diagText }}</pre>
        </details>
      </div>
    </div>
  </div>
</template>
