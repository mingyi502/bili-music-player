/**
 * 书签小工具的源码（用户在浏览器里点一下即可复制 Cookie）。
 * 之所以可行：QQ音乐网页自己就用 document.cookie 读 qqmusic_key（与 qm_keyst 同值）。
 * 这里只做纯逻辑（生成文本 / 解析粘贴内容），便于 Node 单测。
 */

/** 生成可放进浏览器书签的 javascript: 代码 */
export function buildBookmarklet() {
  const code = `javascript:(function(){var c=document.cookie||'';var k=(c.match(/(^|;\\s*)qqmusic_key=([^;]*)/)||[])[2]||'';var u=(c.match(/(^|;\\s*)(qqmusic_uin|uin|ptui_loginuin)=([^;]*)/)||[])[3]||'';if(!k){alert('没读到 qqmusic_key，请先在 y.qq.com 登录');return}var out=(u?'uin='+u+'; ':'')+'qqmusic_key='+k;try{navigator.clipboard.writeText(out);alert('已复制到剪贴板，粘贴到 App 的 Cookie 框即可')}catch(e){prompt('复制下面全部内容：',out)}})()`
  return code
}

/** 清洗用户粘贴的内容：可能整段来自 DevTools 的 "Cookie: xxx"，也可能是 bookmarklet 的输出 */
export function normalizePastedCookie(text) {
  let s = String(text || '').trim()
  // 去掉可能的 "Cookie:" 前缀与引号
  s = s.replace(/^cookie\s*:\s*/i, '').replace(/^["']|["']$/g, '')
  // 压成单行，去掉换行与多余空格
  s = s.replace(/\s*\n\s*/g, ' ').replace(/\s*;\s*/g, '; ').replace(/\s{2,}/g, ' ').trim()
  // 只保留 name=value 形式的片段
  const parts = s
    .split(';')
    .map((p) => p.trim())
    .filter((p) => /^[^=;\s]+=[^;]*$/.test(p))
  return parts.join('; ')
}

/** 该 Cookie 里有没有可用于登录的关键项 */
export function cookieHasLogin(cookie) {
  return /(?:^|;\s*)(qm_keyst|qqmusic_key)=/.test(String(cookie || ''))
}
