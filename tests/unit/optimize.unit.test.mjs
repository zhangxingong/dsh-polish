// 白盒单测：optimize（lib/optimize.js 真实实现）
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildOptimizePrompt, callDeepSeekOptimize, OptimizeError, MODEL, BASE_URL } from '../../lib/optimize.js'

/** 造 fetch 替身：返回给定 status + json。 */
function fakeFetch(status, json) {
  return async (url, init) => {
    calls.push({ url, init })
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => json,
    }
  }
}
let calls = []

test.beforeEach(() => {
  calls = []
})

test.describe('buildOptimizePrompt', () => {
  test('model/temperature/stream 固定', () => {
    const p = buildOptimizePrompt('你好')
    assert.equal(p.model, MODEL)
    assert.equal(p.temperature, 0.3)
    assert.equal(p.stream, false)
  })
  test('max_tokens 下限 1024', () => {
    assert.equal(buildOptimizePrompt('短').max_tokens, 1024)
  })
  test('max_tokens = 2×len+512，上限 8192', () => {
    // 注：len 需 ≥256 才进入 2×len+512 区间（下限 1024 钳制）；brief 原用 100 会命中钳制而失败
    assert.equal(buildOptimizePrompt('x'.repeat(1000)).max_tokens, 1000 * 2 + 512)
    assert.equal(buildOptimizePrompt('x'.repeat(100000)).max_tokens, 8192)
  })
  test('system 含四条优化规则与只输出正文约束', () => {
    const p = buildOptimizePrompt('你好')
    const s = p.messages[0].content
    for (const kw of ['核心想法', '语病', '冗余', '细节', '语气风格', '只输出优化后的完整文本']) {
      assert.ok(s.includes(kw), `system 应包含「${kw}」`)
    }
    assert.deepEqual(p.messages[1], { role: 'user', content: '你好' })
  })
})

test.describe('callDeepSeekOptimize', () => {
  test('成功：返回 choices[0].message.content', async () => {
    const out = await callDeepSeekOptimize('原文', {
      fetchImpl: fakeFetch(200, { choices: [{ message: { content: '优化后' } }] }),
      resolveApiKey: async () => 'sk-test',
    })
    assert.equal(out, '优化后')
    assert.equal(calls[0].url, `${BASE_URL}/chat/completions`)
    assert.equal(calls[0].init.headers.authorization, 'Bearer sk-test')
  })
  test('缺密钥：resolveApiKey 抛错 → missing-credential', async () => {
    await assert.rejects(
      callDeepSeekOptimize('x', { fetchImpl: fakeFetch(200, {}), resolveApiKey: async () => { throw new Error('no key') } }),
      (err) => err instanceof OptimizeError && err.code === 'missing-credential',
    )
    assert.equal(calls.length, 0)
  })
  test('HTTP 错误：透出 API error message', async () => {
    await assert.rejects(
      callDeepSeekOptimize('x', {
        fetchImpl: fakeFetch(429, { error: { message: 'rate limited' } }),
        resolveApiKey: async () => 'sk-test',
      }),
      (err) => err instanceof OptimizeError && err.code === 'api-error' && err.message === 'rate limited',
    )
  })
  test('网络失败 → transport', async () => {
    await assert.rejects(
      callDeepSeekOptimize('x', {
        fetchImpl: async () => { throw new Error('ECONNREFUSED') },
        resolveApiKey: async () => 'sk-test',
      }),
      (err) => err instanceof OptimizeError && err.code === 'transport',
    )
  })
  test('content 为空 → empty-response', async () => {
    await assert.rejects(
      callDeepSeekOptimize('x', {
        fetchImpl: fakeFetch(200, { choices: [{ message: { content: '   ' } }] }),
        resolveApiKey: async () => 'sk-test',
      }),
      (err) => err instanceof OptimizeError && err.code === 'empty-response',
    )
  })
  test('非 JSON 响应 → api-error', async () => {
    await assert.rejects(
      callDeepSeekOptimize('x', {
        fetchImpl: async () => ({ ok: true, status: 200, json: async () => { throw new Error('bad json') } }),
        resolveApiKey: async () => 'sk-test',
      }),
      (err) => err instanceof OptimizeError && err.code === 'api-error',
    )
  })
})
