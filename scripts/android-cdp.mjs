/**
 * Android WebView 调试桥（CDP）—— 真机 / 模拟器验证用。
 *
 * 前置（见 HANDOVER-LOCAL.md）：
 *   1) adb -H 127.0.0.1 -P 5037 -s <dev> shell pidof com.bilimusic.player
 *   2) adb -H 127.0.0.1 -P 5037 -s <dev> forward tcp:9333 localabstract:webview_devtools_remote_<pid>
 *
 * 用法（Node >= 22，依赖全局 WebSocket）：
 *   node scripts/android-cdp.mjs list
 *   node scripts/android-cdp.mjs eval <expr.js> [port]    # expr.js 里写一段 JS 表达式（IIFE 即可）
 *   node scripts/android-cdp.mjs shot <out.png> [port]    # 截图（CSS 像素坐标系）
 */
import { readFileSync, writeFileSync } from 'node:fs'

const [cmd, arg, portArg] = process.argv.slice(2)
const port = Number(portArg || (cmd === 'list' && /^\d+$/.test(arg) ? arg : 9333))

async function listPages() {
  const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
  return pages.filter((p) => p.type === 'page')
}

const pages = await listPages()
if (cmd === 'list') {
  console.log(JSON.stringify(pages.map((p) => ({ title: p.title, url: p.url, id: p.id })), null, 2))
  process.exit(0)
}

const page = pages.find((p) => /localhost/.test(p.url)) || pages[0]
if (!page) {
  console.error('未找到页面；先确认 adb forward 与应用在前台（Flyme 需 am start 唤醒）')
  process.exit(1)
}

const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const pending = new Map()
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data)
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg)
    pending.delete(msg.id)
  }
})
await new Promise((res, rej) => {
  ws.addEventListener('open', res)
  ws.addEventListener('error', rej)
})
const send = (method, params) =>
  new Promise((res) => {
    const i = ++id
    pending.set(i, res)
    ws.send(JSON.stringify({ id: i, method, params }))
  })

if (cmd === 'eval') {
  const expr = readFileSync(arg, 'utf8')
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  if (r.result?.exceptionDetails) {
    console.error('EXCEPTION:', JSON.stringify(r.result.exceptionDetails).slice(0, 600))
    process.exit(1)
  }
  console.log(JSON.stringify(r.result?.result?.value ?? null, null, 2))
} else if (cmd === 'shot') {
  const r = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(arg, Buffer.from(r.result.data, 'base64'))
  console.log('saved', arg)
} else {
  console.error('用法: node scripts/android-cdp.mjs list | eval <expr.js> | shot <out.png> [port]')
  process.exit(1)
}

ws.close()
process.exit(0)
