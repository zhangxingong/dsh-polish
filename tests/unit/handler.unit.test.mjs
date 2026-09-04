// 白盒单测：handler（lib/handler.js 真实实现，真实 HTTP 全链路 + 假 optimize）
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { createPolishHandler } from '../../lib/handler.js'

const LOGGER = { warn: () => {}, error: () => {} }

function makeCtx() {
  return { logger: LOGGER }
}

/** 起真实 HTTP 服务，返回 baseUrl 与关闭函数。 */
async function serve(optimize) {
  const handler = createPolishHandler(makeCtx(), { optimize })
  const server = http.createServer((req, res) => { void handler(req, res) })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}

async function post(baseUrl, body, extraHeaders = {}) {
  return fetch(`${baseUrl}/dsh-polish/optimize`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...extraHeaders },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

test.describe('handler（真实 HTTP）', () => {
  test('200：假 optimize 结果透传', async () => {
    const { baseUrl, close } = await serve(async (text) => `OPT:${text}`)
    const res = await post(baseUrl, { text: '原文' })
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), { ok: true, text: 'OPT:原文' })
    await close()
  })
  test('403：非 loopback Host（raw request 伪造 Host 头）', async () => {
    const { baseUrl, close } = await serve(async (t) => t)
    const { port } = new URL(baseUrl)
    const res = await new Promise((resolve, reject) => {
      const req = http.request(
        { host: '127.0.0.1', port, path: '/dsh-polish/optimize', method: 'POST', headers: { host: 'evil.example.com', 'content-type': 'application/json' } },
        (r) => { let b = ''; r.on('data', (c) => (b += c)); r.on('end', () => resolve({ status: r.statusCode, body: b })) },
      )
      req.on('error', reject)
      req.end(JSON.stringify({ text: 'x' }))
    })
    assert.equal(res.status, 403)
    assert.equal(res.body, 'forbidden')
    await close()
  })
  test('405：GET 拒绝', async () => {
    const { baseUrl, close } = await serve(async (t) => t)
    const res = await fetch(`${baseUrl}/dsh-polish/optimize`)
    assert.equal(res.status, 405)
    await close()
  })
  test('400：非法 JSON', async () => {
    const { baseUrl, close } = await serve(async (t) => t)
    const res = await post(baseUrl, '{not json')
    assert.equal(res.status, 400)
    assert.deepEqual(await res.json(), { ok: false, code: 'bad-request', message: 'invalid JSON' })
    await close()
  })
  test('400：text 非字符串', async () => {
    const { baseUrl, close } = await serve(async (t) => t)
    const res = await post(baseUrl, { text: 42 })
    assert.equal(res.status, 400)
    assert.deepEqual((await res.json()).code, 'invalid-text')
    await close()
  })
  test('400：text 空白', async () => {
    const { baseUrl, close } = await serve(async (t) => t)
    const res = await post(baseUrl, { text: '   ' })
    assert.equal(res.status, 400)
    assert.deepEqual((await res.json()).code, 'empty-text')
    await close()
  })
  test('502：optimize 抛 OptimizeError → code/message 透传', async () => {
    const { OptimizeError } = await import('../../lib/optimize.js')
    const { baseUrl, close } = await serve(async () => { throw new OptimizeError('missing-credential', 'no key') })
    const res = await post(baseUrl, { text: 'x' })
    assert.equal(res.status, 502)
    assert.deepEqual(await res.json(), { ok: false, code: 'missing-credential', message: 'no key' })
    await close()
  })
  test('502：optimize 抛未知错误 → internal-error', async () => {
    const { baseUrl, close } = await serve(async () => { throw new Error('boom') })
    const res = await post(baseUrl, { text: 'x' })
    assert.equal(res.status, 502)
    assert.deepEqual((await res.json()).code, 'internal-error')
    await close()
  })
  test('413：content-length 预声明超限', async () => {
    const { baseUrl, close } = await serve(async (t) => t)
    const { port } = new URL(baseUrl)
    const res = await new Promise((resolve, reject) => {
      const req = http.request(
        { host: '127.0.0.1', port, path: '/dsh-polish/optimize', method: 'POST', headers: { 'content-type': 'application/json', 'content-length': '50331649' } },
        (r) => { let b = ''; r.on('data', (c) => (b += c)); r.on('end', () => resolve({ status: r.statusCode, body: b })) },
      )
      req.on('error', reject)
      req.end(JSON.stringify({ text: 'x' }))
    })
    assert.equal(res.status, 413)
    await close()
  })
  test('400：text 超 200KB', async () => {
    const { baseUrl, close } = await serve(async (t) => t)
    const res = await post(baseUrl, { text: 'x'.repeat(210000) })
    assert.equal(res.status, 400)
    assert.deepEqual((await res.json()).code, 'text-too-large')
    await close()
  })
  test('200：images 透传给 optimize', async () => {
    let seen
    const { baseUrl, close } = await serve(async (text, images) => { seen = { text, images }; return 'OPT' })
    const res = await post(baseUrl, { text: 'x', images: [{ mediaType: 'image/png', data: 'aGk=' }] })
    assert.equal(res.status, 200)
    assert.deepEqual(seen, { text: 'x', images: [{ mediaType: 'image/png', data: 'aGk=' }] })
    await close()
  })
  test('images 缺省 → optimize 收到空数组', async () => {
    let seen
    const { baseUrl, close } = await serve(async (text, images) => { seen = images; return 'OPT' })
    const res = await post(baseUrl, { text: 'x' })
    assert.equal(res.status, 200)
    assert.deepEqual(seen, [])
    await close()
  })
  test('400：images 非数组 → invalid-images', async () => {
    const { baseUrl, close } = await serve(async (t) => t)
    const res = await post(baseUrl, { text: 'x', images: 'nope' })
    assert.equal(res.status, 400)
    assert.deepEqual((await res.json()).code, 'invalid-images')
    await close()
  })
  test('400：非法图片项 → invalid-image', async () => {
    const { baseUrl, close } = await serve(async (t) => t)
    const res = await post(baseUrl, { text: 'x', images: [{ mediaType: 'image/bmp', data: 'aGk=' }] })
    assert.equal(res.status, 400)
    assert.deepEqual((await res.json()).code, 'invalid-image')
    await close()
  })
  test('400：超 20 张 → too-many-images', async () => {
    const { baseUrl, close } = await serve(async (t) => t)
    const many = Array.from({ length: 21 }, () => ({ mediaType: 'image/png', data: 'aGk=' }))
    const res = await post(baseUrl, { text: 'x', images: many })
    assert.equal(res.status, 400)
    assert.deepEqual((await res.json()).code, 'too-many-images')
    await close()
  })
  test('400：单图 base64 解码超 32MB → image-too-large', async () => {
    const { baseUrl, close } = await serve(async (t) => t)
    const big = { mediaType: 'image/png', data: Buffer.alloc(33 * 1024 * 1024).toString('base64') }
    const res = await post(baseUrl, { text: 'x', images: [big] })
    assert.equal(res.status, 400)
    assert.deepEqual((await res.json()).code, 'image-too-large')
    await close()
  })
})
