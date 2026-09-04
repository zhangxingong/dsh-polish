// 白盒单测：optimize（lib/optimize.js 真实实现）
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildOptimizePrompt, callDeepSeekOptimize, OptimizeError, MODEL, BASE_URL, SYSTEM_PROMPT } from '../../lib/optimize.js'

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
    assert.deepEqual(p.messages[1], { role: 'user', content: [{ type: 'text', text: '你好' }] })
  })
  test('自定义 systemPrompt 透传', () => {
    const p = buildOptimizePrompt('x', [], '自定义提示')
    assert.equal(p.messages[0].content, '自定义提示')
  })
  test('空白 systemPrompt 回退默认', async () => {
    await callDeepSeekOptimize('x', {
      fetchImpl: fakeFetch(200, { choices: [{ message: { content: '优化后' } }] }),
      resolveApiKey: async () => 'sk-test',
      systemPrompt: '   ',
    })
    assert.equal(JSON.parse(calls[0].init.body).messages[0].content, SYSTEM_PROMPT)
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
    assert.ok(calls[0].init.signal instanceof AbortSignal, '应带 AbortSignal 超时')
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
  test('不传 systemPrompt → 默认', async () => {
    await callDeepSeekOptimize('x', {
      fetchImpl: fakeFetch(200, { choices: [{ message: { content: '优化后' } }] }),
      resolveApiKey: async () => 'sk-test',
    })
    assert.equal(JSON.parse(calls[0].init.body).messages[0].content, SYSTEM_PROMPT)
  })
  test('自定义 systemPrompt → 请求体带自定义', async () => {
    await callDeepSeekOptimize('x', {
      fetchImpl: fakeFetch(200, { choices: [{ message: { content: '优化后' } }] }),
      resolveApiKey: async () => 'sk-test',
      systemPrompt: '我的专属提示',
    })
    assert.equal(JSON.parse(calls[0].init.body).messages[0].content, '我的专属提示')
  })
})

test.describe('buildOptimizePrompt vision', () => {
  test('MODEL 为 vision 模型', () => {
    assert.equal(MODEL, 'deepseek-v4-flash-vision-exp')
  })
  test('上传图 → data URI image_url 块', () => {
    const p = buildOptimizePrompt('看图', [{ mediaType: 'image/png', data: 'aGVsbG8=' }])
    assert.deepEqual(p.messages[1].content[1], { type: 'image_url', image_url: { url: 'data:image/png;base64,aGVsbG8=' } })
  })
  test('文本内图片链接 → image_url 块，链接保留在文本中', () => {
    const p = buildOptimizePrompt('见图 https://cdn.example.com/a.png 谢谢')
    assert.deepEqual(p.messages[1].content, [
      { type: 'text', text: '见图 https://cdn.example.com/a.png 谢谢' },
      { type: 'image_url', image_url: { url: 'https://cdn.example.com/a.png' } },
    ])
  })
  test('多链接、大小写扩展名与 query 参数', () => {
    const p = buildOptimizePrompt('https://a.com/1.JPG?x=1 和 http://b.com/t.gif')
    assert.deepEqual(p.messages[1].content.slice(1), [
      { type: 'image_url', image_url: { url: 'https://a.com/1.JPG?x=1' } },
      { type: 'image_url', image_url: { url: 'http://b.com/t.gif' } },
    ])
  })
  test('无扩展名图片 URL 不提取', () => {
    const p = buildOptimizePrompt('看 https://example.com/photo?id=3')
    assert.equal(p.messages[1].content.length, 1)
  })
  test('普通网页链接不提取', () => {
    const p = buildOptimizePrompt('看 https://example.com/page')
    assert.equal(p.messages[1].content.length, 1)
  })
  test('混合：上传图在前，链接在后', () => {
    const p = buildOptimizePrompt('见图 https://a.com/x.png', [{ mediaType: 'image/jpeg', data: 'eA==' }])
    assert.deepEqual(p.messages[1].content.slice(1), [
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,eA==' } },
      { type: 'image_url', image_url: { url: 'https://a.com/x.png' } },
    ])
  })
  test('callDeepSeekOptimize 经 deps.images 透传 → 请求体 content 带图块', async () => {
    await callDeepSeekOptimize('x', {
      fetchImpl: fakeFetch(200, { choices: [{ message: { content: '优化后' } }] }),
      resolveApiKey: async () => 'sk-test',
      images: [{ mediaType: 'image/webp', data: 'aGk=' }],
    })
    const body = JSON.parse(calls[0].init.body)
    assert.deepEqual(body.messages[1].content, [
      { type: 'text', text: 'x' },
      { type: 'image_url', image_url: { url: 'data:image/webp;base64,aGk=' } },
    ])
  })
})
