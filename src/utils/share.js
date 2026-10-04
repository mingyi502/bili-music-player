/**
 * 分享链接构造（平台无关，纯函数）。
 * 歌曲：`y.qq.com/n/ryqq/songDetail/<mid>`；歌单：`y.qq.com/n/ryqq/playlist/<disstid>`。
 */

/** 歌曲分享链接（需要 mid；无 mid 返回空串） */
export function songShareUrl(mid) {
  const m = String(mid || '').trim()
  return /^[A-Za-z0-9]+$/.test(m) ? `https://y.qq.com/n/ryqq/songDetail/${m}` : ''
}

/** 歌单分享链接（仅 QQ 数字歌单 id；本地/导入歌单返回空串） */
export function playlistShareUrl(id) {
  const v = String(id || '').trim()
  return /^\d+$/.test(v) ? `https://y.qq.com/n/ryqq/playlist/${v}` : ''
}

/** 分享标题：歌名 - 歌手（缺歌手时只留歌名） */
export function shareTitle(name, singers) {
  const n = String(name || '').trim()
  const s = (Array.isArray(singers) ? singers : String(singers || '').split('/'))
    .map((x) => String(x || '').trim())
    .filter(Boolean)
    .join(' / ')
  return s ? `${n} - ${s}` : n
}
