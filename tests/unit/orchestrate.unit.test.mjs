// 白盒单测：orchestrate（lib/orchestrate.js 真实实现，注入替身）
import test from 'node:test'
import assert from 'node:assert/strict'
import { postJson, runPolishClick, EMPTY_HINT } from '../../lib/orchestrate.js'

/** 记录型 glue：捕获调用序列。 */
function makeGlue(postResult) {
  const calls = []
  return {
    calls,
    glue: {
      post: async (text) => { calls.push(['post', text]); return postResult },
      setDraft: (text) => calls.push(['setDraft', text]),
      focusEnd: () => calls.push(['focusEnd']),
      notify: (text) => calls.push(['notify', text]),
    },
  }
}

test.describe('runPolishClick', () => {
  test('empty → 只提示空输入文案，不 post', async () => {
    const { calls, glue } = makeGlue({ ok: true, text: 'x' })
    await runPolishClick('empty', '   ', glue)
    assert.deepEqual(calls, [['notify', EMPTY_HINT]])
  })
  test('disabled → 完全无动作', async () => {
    const { calls, glue } = makeGlue({ ok: true, text: 'x' })
    await runPolishClick('disabled', '原文', glue)
    assert.deepEqual(calls, [])
  })
  test('ready 成功 → setDraft(优化文本) + focusEnd', async () => {
    const { calls, glue } = makeGlue({ ok: true, text: '优化后' })
    await runPolishClick('ready', '原文', glue)
    assert.deepEqual(calls, [
      ['post', '原文'],
      ['setDraft', '优化后'],
      ['focusEnd'],
    ])
  })
  test('ready 失败 → notify 错误信息，不动 draft', async () => {
    const { calls, glue } = makeGlue({ ok: false, code: 'api-error', message: 'API 挂了' })
    await runPolishClick('ready', '原文', glue)
    assert.deepEqual(calls, [
      ['post', '原文'],
      ['notify', 'API 挂了'],
    ])
  })
  test('ready 失败且无 message → 兜底文案', async () => {
    const { calls, glue } = makeGlue({ ok: false })
    await runPolishClick('ready', '原文', glue)
    assert.deepEqual(calls[1], ['notify', '优化失败，请稍后重试'])
  })
  test('ready 成功但草稿已变化 → 提示不覆盖', async () => {
    const base = makeGlue({ ok: true, text: '优化后' })
    base.glue.getCurrentDraft = () => '用户新输入'
    await runPolishClick('ready', '原文', base.glue)
    assert.deepEqual(base.calls, [
      ['post', '原文'],
      ['notify', '输入已变化，未覆盖'],
    ])
  })
  test('ready 成功且草稿未变 → 正常覆盖', async () => {
    const base = makeGlue({ ok: true, text: '优化后' })
    base.glue.getCurrentDraft = () => '原文'
    await runPolishClick('ready', '原文', base.glue)
    assert.deepEqual(base.calls, [
      ['post', '原文'],
      ['setDraft', '优化后'],
      ['focusEnd'],
    ])
  })
  test('空白结果文本 → 走失败提示', async () => {
    const { calls, glue } = makeGlue({ ok: true, text: '   ' })
    await runPolishClick('ready', '原文', glue)
    assert.deepEqual(calls, [
      ['post', '原文'],
      ['notify', '优化失败，请稍后重试'],
    ])
  })
})

test.describe('postJson', () => {
  const ok = (json) => async () => ({ ok: true, status: 200, json: async () => json })

  test('200 透传 JSON', async () => {
    const r = await postJson('/x', { a: 1 }, ok({ ok: true, text: 'y' }))
    assert.deepEqual(r, { ok: true, text: 'y' })
  })
  test('网络错误 → ok:false + message', async () => {
    const r = await postJson('/x', {}, async () => { throw new Error('ECONNREFUSED') })
    assert.equal(r.ok, false)
    assert.match(r.message, /ECONNREFUSED/)
  })
  test('HTTP 错误 → ok:false + 中文状态提示', async () => {
    const r = await postJson('/x', {}, async () => ({ ok: false, status: 502, json: async () => ({}) }))
    assert.equal(r.ok, false)
    assert.match(r.message, /502/)
  })
  test('非 JSON 体 → ok:false + 提示', async () => {
    const r = await postJson('/x', {}, async () => ({ ok: true, status: 200, json: async () => { throw new Error('bad') } }))
    assert.equal(r.ok, false)
  })
  test('200 但体为 null → ok:false', async () => {
    const r = await postJson('/x', {}, async () => ({ ok: true, status: 200, json: async () => null }))
    assert.equal(r.ok, false)
  })
  test('HTTP 错误带宿主 message → 透出', async () => {
    const r = await postJson('/x', {}, async () => ({ ok: false, status: 502, json: async () => ({ message: 'missing-credential 提示' }) }))
    assert.equal(r.ok, false)
    assert.match(r.message, /missing-credential 提示/)
  })
})

test.describe('runPolishClick 图片解析', () => {
  function makeGlueWithImages() {
    const calls = []
    return {
      calls,
      glue: {
        post: async (text, images) => { calls.push(['post', text, images]); return { ok: true, text: '优化后' } },
        setDraft: (text) => calls.push(['setDraft', text]),
        focusEnd: () => calls.push(['focusEnd']),
        notify: (text) => calls.push(['notify', text]),
        getCurrentDraft: () => '原文',
        resolveImages: async () => [{ mediaType: 'image/png', data: 'aGk=' }],
      },
    }
  }

  test('resolveImages 结果随 post 透传', async () => {
    const { calls, glue } = makeGlueWithImages()
    await runPolishClick('ready', '原文', glue)
    assert.deepEqual(calls[0], ['post', '原文', [{ mediaType: 'image/png', data: 'aGk=' }]])
    assert.deepEqual(calls.slice(1), [['setDraft', '优化后'], ['focusEnd']])
  })
  test('resolveImages 抛错 → notify 原消息，不 post 不动草稿', async () => {
    const { calls, glue } = makeGlueWithImages()
    glue.resolveImages = async () => { throw new Error('附件服务不可用') }
    await runPolishClick('ready', '原文', glue)
    assert.deepEqual(calls, [['notify', '附件服务不可用']])
  })
  test('无 resolveImages → post 收到空数组', async () => {
    const { calls, glue } = makeGlueWithImages()
    delete glue.resolveImages
    await runPolishClick('ready', '原文', glue)
    assert.deepEqual(calls[0], ['post', '原文', []])
  })
})
