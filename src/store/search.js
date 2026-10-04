/** 搜索历史（纯本地）：`bmp:search-history`，去重、最新在前、最多 20 条。 */
import { state, LS } from './state.js'

const MAX = 20

function persist() {
  try {
    localStorage.setItem(LS.searchHistory, JSON.stringify(state.searchHistory))
  } catch {
    /* 配额异常不打断业务 */
  }
}

export function addSearchHistory(keyword) {
  const kw = String(keyword || '').trim()
  if (!kw) return
  const i = state.searchHistory.indexOf(kw)
  if (i >= 0) state.searchHistory.splice(i, 1)
  state.searchHistory.unshift(kw)
  if (state.searchHistory.length > MAX) state.searchHistory.length = MAX
  persist()
}

export function clearSearchHistory() {
  state.searchHistory = []
  persist()
}

/** 删除单条搜索历史（2026-09-27） */
export function removeSearchHistory(keyword) {
  const kw = String(keyword || '').trim()
  if (!kw) return
  const i = state.searchHistory.indexOf(kw)
  if (i < 0) return
  state.searchHistory.splice(i, 1)
  persist()
}
