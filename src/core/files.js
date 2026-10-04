/**
 * 文本文件保存能力桥（P7.4 G5）：App 走原生持久目录，Web 走浏览器下载。
 * 与 core/downloads.js 同构：原生注入，未注入时自动降级。
 */
let backend = null

/** 由平台层注入（native/index.js） */
export function setFileBackend(b) {
  backend = b && typeof b.saveTextFile === 'function' ? b : null
}

/** 是否支持原生保存（App）；Web 端用 Blob 下载也算支持 */
export function canSaveFiles() {
  return !!backend
}

/** 保存目录（仅原生） */
export function saveDir() {
  return backend?.dir || ''
}

/**
 * 保存文本文件。
 * @returns {Promise<{ path:string, uri?:string, size:number, web?:boolean }>}
 */
export async function saveTextFile(fileName, text) {
  const name = String(fileName || 'file.txt')
  const body = String(text ?? '')
  if (backend) return backend.saveTextFile(name, body)
  if (typeof document === 'undefined' || typeof Blob === 'undefined') {
    throw new Error('当前环境不支持保存文件')
  }
  const blob = new Blob([body], { type: 'application/octet-stream' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
  return { path: name, size: body.length, web: true }
}
