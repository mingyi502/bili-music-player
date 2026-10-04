import assert from 'node:assert/strict'
import { Writable } from 'node:stream'
import { isAllowedLoginUrl } from '../src/core/qqLogin.js'
import { mediaProxyMiddleware } from '../server/image-proxy.js'

for (const url of [
  'https://xui.ptlogin2.qq.com/check_sig',
  'https://graph.qq.com/oauth2.0/authorize',
]) {
  assert.equal(isAllowedLoginUrl(url), true, `should allow ${url}`)
}
for (const url of [
  'http://xui.ptlogin2.qq.com/check_sig',
  'https://evil.example/check_sig',
  'https://qq.com.evil.example/check_sig',
  'not a URL',
]) {
  assert.equal(isAllowedLoginUrl(url), false, `should reject ${url}`)
}

class MockResponse extends Writable {
  constructor() {
    super()
    this.headersSent = false
    this.statusCode = 0
    this.headers = {}
    this.chunks = []
  }

  writeHead(status, headers = {}) {
    this.statusCode = status
    this.headers = headers
    this.headersSent = true
    return this
  }

  _write(chunk, encoding, callback) {
    this.chunks.push(Buffer.from(chunk))
    callback()
  }
}

async function requestMedia(url) {
  const res = new MockResponse()
  const finished = new Promise((resolve, reject) => {
    res.once('finish', resolve)
    res.once('error', reject)
  })
  mediaProxyMiddleware(
    { url: `/media-api?url=${encodeURIComponent(url)}`, headers: { range: 'bytes=0-2' } },
    res,
    () => assert.fail('media middleware should handle request')
  )
  await finished
  return {
    status: res.statusCode,
    headers: res.headers,
    body: Buffer.concat(res.chunks).toString(),
  }
}

const originalFetch = globalThis.fetch
try {
  let calls = 0
  globalThis.fetch = async () => {
    calls += 1
    return new Response(null, {
      status: 302,
      headers: { location: 'https://evil.example/steal' },
    })
  }
  const rejected = await requestMedia('https://upos-sz-mirrorcos.bilivideo.com/audio.m4s')
  assert.equal(rejected.status, 403)
  assert.equal(calls, 1, 'must not request a redirect target outside the media allowlist')

  const requested = []
  globalThis.fetch = async (url, options) => {
    requested.push({ url: String(url), options })
    if (requested.length === 1) {
      return new Response(null, {
        status: 302,
        headers: { location: 'https://upos-sz-mirrorcos.bilivideo.com/final.m4s' },
      })
    }
    return new Response(Buffer.from('abc'), {
      status: 206,
      headers: { 'content-range': 'bytes 0-2/10', 'content-type': 'audio/mp4' },
    })
  }
  const forwarded = await requestMedia('https://upos-sz-mirrorcos.bilivideo.com/audio.m4s')
  assert.equal(forwarded.status, 206)
  assert.equal(forwarded.body, 'abc')
  assert.equal(requested.length, 2)
  assert.equal(requested[1].options.headers.Range, 'bytes=0-2')
  assert.equal(requested[0].options.redirect, 'manual')
} finally {
  globalThis.fetch = originalFetch
}

console.log('Security regressions: PASS')
