/**
 * 页面层级：
 * - 一级：侧栏入口（首页歌单、每日推荐、FM、搜索、榜单、广场、最近播放、
 *   下载与存储、听歌报告）。返回键在这些页面应最小化 App，而不是回上一页。
 * - 二级：从列表/搜索/播放器打开的详情页（歌手/专辑/歌曲），返回上一页。
 */
const FIRST_LEVEL = new Set([
  '/',
  '/daily',
  '/fm',
  '/search',
  '/rank',
  '/square',
  '/history',
  '/storage',
  '/report',
])

export function isFirstLevelPath(path) {
  return FIRST_LEVEL.has(path || '/')
}

export function isSecondLevelPath(path) {
  return /^\/(artist|album|song)\//.test(String(path || ''))
}
