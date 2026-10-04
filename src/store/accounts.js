/**
 * 多账号切换（P7.2 G3）：把当前登录快照保存到 `bmp:accounts`（最多 5 个），
 * 一键切换（复用 Cookie 登录流程：清残留 → 重新导入歌单 → 体检）。
 * 只保存登录凭证与本机展示信息，不涉及任何服务端写操作。
 */
import { state, LS } from './state.js'
import { toast, askConfirm } from './ui.js'
import { loginWithCookie } from './user.js'

export const ACCOUNTS_MAX = 5

function persistAccounts() {
  try {
    localStorage.setItem(LS.accounts, JSON.stringify(state.accounts))
  } catch {
    /* 配额异常不打断业务 */
  }
}

/** 保存当前登录账号（按 uin 去重，最新在前） */
export function saveCurrentAccount({ silent = false } = {}) {
  const { qqCookie, uin, biliCookie, loginMethod } = state.config
  if (!qqCookie || !uin) {
    if (!silent) toast('当前没有已登录的账号', 'error')
    return null
  }
  const entry = {
    id: String(uin),
    uin: String(uin),
    nickname: state.user?.nickname || `QQ ${uin}`,
    avatar: state.user?.avatar || '',
    cookie: qqCookie,
    biliCookie: biliCookie || '',
    loginMethod: loginMethod || 'cookie',
    savedAt: Date.now(),
  }
  state.accounts = [entry, ...state.accounts.filter((a) => a.id !== entry.id)].slice(0, ACCOUNTS_MAX)
  persistAccounts()
  if (!silent) toast(`已保存账号：${entry.nickname}`, 'success')
  return entry
}

/** 切换账号：保存当前 → 二次确认 → 用目标 Cookie 重新登录并重载数据 */
export async function switchAccount(id) {
  const acc = state.accounts.find((a) => a.id === String(id))
  if (!acc) {
    toast('账号不存在或已被移除', 'error')
    return false
  }
  if (acc.uin === String(state.config.uin)) {
    toast('已经是当前账号', 'info')
    return false
  }
  const ok = await askConfirm({
    title: '切换账号',
    message: `将切换到《${acc.nickname}》（QQ ${acc.uin}）并重新加载歌单，播放会停止。`,
    confirmText: '切换',
  })
  if (!ok) return false
  // 先把当前账号存下来，避免来回切换时丢失
  saveCurrentAccount({ silent: true })
  if (acc.biliCookie) state.config.biliCookie = acc.biliCookie
  await loginWithCookie(acc.cookie)
  toast(`已切换到：${acc.nickname}`, 'success')
  return true
}

/** 从本机移除已保存的账号（不影响 QQ 侧数据） */
export async function removeAccount(id) {
  const acc = state.accounts.find((a) => a.id === String(id))
  if (!acc) return false
  const ok = await askConfirm({
    title: '删除账号',
    message: `将从本机移除已保存的《${acc.nickname}》（QQ ${acc.uin}），不影响账号本身的数据。`,
    confirmText: '删除',
    danger: true,
  })
  if (!ok) return false
  state.accounts = state.accounts.filter((a) => a.id !== String(id))
  persistAccounts()
  toast('已移除保存的账号', 'success')
  return true
}
