<script setup>
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Icon from '../components/Icon.vue'
import AppImage from '../components/AppImage.vue'
import { fetchSimilarSongs, fetchComments } from '../api/qq/songDetail.js'
import { COMMENT_MAX_LEN } from '../api/qq/comment.js'
import { songShareUrl, shareTitle } from '../utils/share.js'
import { state, playLocalQueue, playNext, songKey, postComment, removeComment, isOwnComment, openShare } from '../store/index'

const route = useRoute()
const router = useRouter()

const similar = ref([])
const hotComments = ref([])
const comments = ref([])
const commentTotal = ref(0)
const commentPage = ref(0)
const loading = ref(false)
const loadingMore = ref(false)
const error = ref('')
const commentError = ref('')
// 评论写（P5 E2）：发表 / 回复 / 删除
const commentText = ref('')
const replyTo = ref(null)
const posting = ref(false)
const deletingId = ref('')

const songId = computed(() => String(route.params.id || ''))
const query = computed(() => route.query || {})
/** 展示用歌曲对象（由入口通过 query 传入；缺失时仅展示评论与相似歌曲） */
const song = computed(() => {
  const q = query.value
  const name = String(q.name || '')
  return {
    id: songId.value,
    mid: String(q.mid || ''),
    name: name || '未知歌曲',
    singers: String(q.singers || '')
      .split('/')
      .map((s) => s.trim())
      .filter(Boolean),
    album: String(q.album || ''),
    albumMid: String(q.albumMid || ''),
    cover: String(q.cover || ''),
    interval: Number(q.interval) || 0,
  }
})
const hasBasic = computed(() => !!(query.value.name || query.value.cover))

/** 分享（P5 E3）：需要 mid 才能构造 QQ 音乐链接 */
const shareUrl = computed(() => songShareUrl(song.value.mid))
function onShare() {
  openShare({
    title: shareTitle(song.value.name, song.value.singers),
    subtitle: '来自 bili-music-player',
    url: shareUrl.value,
  })
}

function fmtDuration(sec) {
  if (!sec || !isFinite(sec)) return ''
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

function fmtDate(sec) {
  if (!sec) return ''
  const d = new Date(sec * 1000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function fmtPraise(n) {
  const v = Number(n) || 0
  if (v >= 1e4) return `${(v / 1e4).toFixed(1)} 万`
  return String(v)
}

async function loadAll() {
  loading.value = true
  error.value = ''
  commentError.value = ''
  similar.value = []
  hotComments.value = []
  comments.value = []
  commentTotal.value = 0
  commentPage.value = 0
  const id = songId.value
  if (!id) {
    error.value = '缺少歌曲 ID'
    loading.value = false
    return
  }
  const [sim, cmt] = await Promise.allSettled([
    fetchSimilarSongs(id, { cookie: state.config.qqCookie, uin: state.config.uin }),
    fetchComments(id, { page: 0, cookie: state.config.qqCookie }),
  ])
  if (sim.status === 'fulfilled') similar.value = sim.value
  if (cmt.status === 'fulfilled') {
    hotComments.value = cmt.value.hot
    comments.value = cmt.value.list
    commentTotal.value = cmt.value.total
  } else {
    commentError.value = cmt.reason?.message || '评论加载失败'
  }
  loading.value = false
}

async function loadMoreComments() {
  if (loadingMore.value) return
  loadingMore.value = true
  try {
    const next = commentPage.value + 1
    const res = await fetchComments(songId.value, { page: next, cookie: state.config.qqCookie })
    comments.value = comments.value.concat(res.list)
    commentPage.value = next
    if (res.total) commentTotal.value = res.total
  } catch (e) {
    commentError.value = e.message || '评论加载失败'
  } finally {
    loadingMore.value = false
  }
}

/** 重新拉取第一页评论（发表/删除后用真实数据校准本地列表） */
async function refreshComments() {
  try {
    const res = await fetchComments(songId.value, { page: 0, cookie: state.config.qqCookie })
    hotComments.value = res.hot
    comments.value = res.list
    commentTotal.value = res.total
    commentPage.value = 0
    commentError.value = ''
  } catch (e) {
    commentError.value = e.message || '评论刷新失败'
  }
}

function startReply(c) {
  replyTo.value = { id: c.id, nick: c.nick }
}

function cancelReply() {
  replyTo.value = null
}

async function submitComment() {
  if (posting.value) return
  const text = commentText.value.trim()
  if (!text) return
  posting.value = true
  try {
    const res = await postComment(songId.value, text, replyTo.value?.id || '')
    if (res) {
      commentText.value = ''
      replyTo.value = null
      await refreshComments()
    }
  } finally {
    posting.value = false
  }
}

async function onDeleteComment(c) {
  if (deletingId.value) return
  deletingId.value = c.id
  try {
    const ok = await removeComment(c.id)
    if (ok) {
      hotComments.value = hotComments.value.filter((x) => x.id !== c.id)
      comments.value = comments.value.filter((x) => x.id !== c.id)
      commentTotal.value = Math.max(0, commentTotal.value - 1)
    }
  } finally {
    deletingId.value = ''
  }
}

function playSong() {
  if (hasBasic.value) playLocalQueue([song.value], 0)
}function onPlayNext() {
  if (hasBasic.value) playNext(song.value)
}

function playSimilar(i) {
  playLocalQueue(similar.value, i)
}

watch(songId, () => {
  if (songId.value) loadAll()
})
if (songId.value) loadAll()
</script>

<template>
  <div class="song-view">
    <div v-if="loading" class="center-msg">
      <div>
        <span class="spin"><Icon name="refresh" :size="30" /></span>
        <div style="margin-top: 10px">正在加载歌曲详情…</div>
      </div>
    </div>

    <div v-else-if="error && !songId" class="sv-error">{{ error }}</div>

    <template v-else>
      <div class="sd-head">
        <AppImage class="sd-cover" :src="song.cover" alt="" placeholder />
        <div class="sd-meta">
          <div class="sd-name">{{ song.name }}</div>
          <div class="sd-sub">
            <span>{{ song.singers.join(' / ') || '未知歌手' }}</span>
            <span v-if="song.album">{{ song.album }}</span>
            <span v-if="song.interval">{{ fmtDuration(song.interval) }}</span>
          </div>
          <div class="sd-actions">
            <button class="btn primary" :disabled="!hasBasic" @click="playSong"><Icon name="play" :size="15" /> 播放</button>
            <button class="btn ghost" :disabled="!hasBasic" @click="onPlayNext"><Icon name="plus" :size="15" /> 下一首</button>
            <button v-if="song.albumMid" class="btn ghost" @click="router.push(`/album/${song.albumMid}`)">
              <Icon name="playlist" :size="14" /> 查看专辑
            </button>
            <button v-if="shareUrl" class="btn ghost" @click="onShare"><Icon name="share" :size="14" /> 分享</button>
            <span v-if="!hasBasic" class="sd-hint">（从播放器进入可看到完整信息）</span>
          </div>
        </div>
      </div>

      <!-- 相似歌曲 -->
      <div class="sd-section">
        <div class="sd-title"><Icon name="wand" :size="15" /> 相似歌曲</div>
        <div v-if="similar.length" class="sd-similar">
          <div v-for="(s, i) in similar" :key="s.mid || s.id || i" class="sd-sim-row" @click="playSimilar(i)">
            <AppImage class="s-cover" :src="s.cover" alt="" placeholder />
            <div class="s-main">
              <div class="s-name">{{ s.name }}</div>
              <div class="s-sub">{{ s.singers.join(' / ') || '未知歌手' }}</div>
            </div>
            <div class="s-album">{{ s.album || '—' }}</div>
            <div class="s-time">{{ fmtDuration(s.interval) }}</div>
            <div class="s-actions" @click.stop>
              <button class="icon-btn" title="播放" @click="playSimilar(i)"><Icon name="play" :size="15" /></button>
            </div>
          </div>
        </div>
        <div v-else class="sd-empty">暂无相似歌曲</div>
      </div>

      <!-- 评论 -->
      <div class="sd-section">
        <div class="sd-title">
          <Icon name="lyrics" :size="15" /> 热门评论
          <span v-if="commentTotal" class="sd-count">{{ commentTotal }} 条</span>
        </div>
        <div class="sd-composer">
          <textarea
            v-model="commentText"
            class="sd-comment-input"
            :maxlength="COMMENT_MAX_LEN"
            :placeholder="replyTo ? `回复 @${replyTo.nick}…` : '说点什么…'"
            rows="2"
          ></textarea>
          <div class="sd-composer-bar">
            <button v-if="replyTo" class="btn ghost sm" @click="cancelReply">取消回复</button>
            <span class="sd-composer-count">{{ commentText.length }}/{{ COMMENT_MAX_LEN }}</span>
            <button class="btn primary sm" :disabled="posting || !commentText.trim()" @click="submitComment">
              <Icon :name="posting ? 'refresh' : 'check'" :size="14" :class="{ spin: posting }" />
              {{ posting ? '发表中…' : replyTo ? '回复' : '发表' }}
            </button>
          </div>
        </div>
        <div v-if="commentError" class="sv-error">{{ commentError }}</div>
        <template v-else>
          <div v-for="c in hotComments" :key="c.id" class="sd-comment">
            <AppImage class="sd-avatar" :src="c.avatar" alt="" placeholder />
            <div class="sd-c-main">
              <div class="sd-c-nick">
                {{ c.nick }}<span class="sd-c-hot">热评</span>
              </div>
              <div class="sd-c-text">{{ c.content }}</div>
              <div class="sd-c-sub">
                <span v-if="c.time">{{ fmtDate(c.time) }}</span>
                <span v-if="c.praise">👍 {{ fmtPraise(c.praise) }}</span>
                <button class="sd-c-act" title="回复" @click="startReply(c)">回复</button>
                <button v-if="isOwnComment(c)" class="sd-c-act danger" title="删除评论" :disabled="deletingId === c.id" @click="onDeleteComment(c)">
                  {{ deletingId === c.id ? '删除中…' : '删除' }}
                </button>
              </div>
            </div>
          </div>

          <div class="sd-title" style="margin-top: 14px"><Icon name="clock" :size="15" /> 最新评论</div>
          <div v-for="c in comments" :key="c.id" class="sd-comment">
            <AppImage class="sd-avatar" :src="c.avatar" alt="" placeholder />
            <div class="sd-c-main">
              <div class="sd-c-nick">{{ c.nick }}</div>
              <div class="sd-c-text">{{ c.content }}</div>
              <div class="sd-c-sub">
                <span v-if="c.time">{{ fmtDate(c.time) }}</span>
                <span v-if="c.praise">👍 {{ fmtPraise(c.praise) }}</span>
                <button class="sd-c-act" title="回复" @click="startReply(c)">回复</button>
                <button v-if="isOwnComment(c)" class="sd-c-act danger" title="删除评论" :disabled="deletingId === c.id" @click="onDeleteComment(c)">
                  {{ deletingId === c.id ? '删除中…' : '删除' }}
                </button>
              </div>
            </div>
          </div>
          <div v-if="!comments.length && !hotComments.length" class="sd-empty">暂无评论</div>
          <div class="sv-more">
            <button v-if="comments.length" class="btn ghost" :disabled="loadingMore" @click="loadMoreComments">
              <Icon :name="loadingMore ? 'refresh' : 'chevronDown'" :size="14" :class="{ spin: loadingMore }" />
              {{ loadingMore ? '加载中…' : '加载更多评论' }}
            </button>
          </div>
        </template>
      </div>
    </template>
  </div>
</template>
