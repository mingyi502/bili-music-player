/**
 * 全局共享的图片可见性观察器。
 * 每张 AppImage 单独 new IntersectionObserver 时，500 行播放队列会创建 500 个
 * observer，展开面板时明显掉帧；这里只保留一个观察器。
 */
let observer = null
const callbacks = new Map()

function getObserver() {
  if (observer || typeof IntersectionObserver === 'undefined') return observer
  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        const cb = callbacks.get(entry.target)
        if (!cb) continue
        callbacks.delete(entry.target)
        observer.unobserve(entry.target)
        cb()
      }
    },
    { rootMargin: '200px' }
  )
  return observer
}

export function observeImage(el, cb) {
  const ins = getObserver()
  if (!ins || !el) return false
  callbacks.set(el, cb)
  ins.observe(el)
  return true
}

export function unobserveImage(el) {
  callbacks.delete(el)
  if (observer && el) observer.unobserve(el)
}
