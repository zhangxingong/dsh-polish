// 白盒单测：设置卡片草稿状态机（lib/settings-state.js，纯 reducer）
import test from 'node:test'
import assert from 'node:assert/strict'
import { CARD_INITIAL, cardReduce } from '../../lib/settings-state.js'

/** 便捷构造：ready 且可写的 scope 事件。 */
function scopeEvent(value, { status = 'ready', writable = true } = {}) {
  return { kind: 'scope', status, value, writable }
}

test.describe('settings-state 卡片草稿状态机', () => {
  test('scope 初始化草稿：ready 事件写入草稿', () => {
    const s = cardReduce(CARD_INITIAL, scopeEvent('默认提示词'))
    assert.equal(s.status, 'ready')
    assert.equal(s.draft, '默认提示词')
    assert.equal(s.dirty, false)
    assert.equal(s.writable, true)
  })
  test('unavailable → 禁用且草稿取 scope 值', () => {
    const s = cardReduce(CARD_INITIAL, scopeEvent('x', { status: 'unavailable' }))
    assert.equal(s.writable, false)
  })
  test('edit 置 dirty 并清除 saved/error', () => {
    let s = cardReduce(CARD_INITIAL, scopeEvent('默认'))
    s = cardReduce(s, { kind: 'edit', draft: '新文案' })
    assert.equal(s.draft, '新文案')
    assert.equal(s.dirty, true)
  })
  test('save-start → save-ok 清 dirty 置 saved', () => {
    let s = cardReduce(CARD_INITIAL, scopeEvent('默认'))
    s = cardReduce(s, { kind: 'edit', draft: '新文案' })
    s = cardReduce(s, { kind: 'save-start' })
    assert.equal(s.saving, true)
    s = cardReduce(s, { kind: 'save-ok' })
    assert.equal(s.saving, false)
    assert.equal(s.saved, true)
    assert.equal(s.dirty, false)
    assert.equal(s.error, null)
  })
  test('save-fail 留 dirty 置 error 且保留草稿', () => {
    let s = cardReduce(CARD_INITIAL, scopeEvent('默认'))
    s = cardReduce(s, { kind: 'edit', draft: '新文案' })
    s = cardReduce(s, { kind: 'save-start' })
    s = cardReduce(s, { kind: 'save-fail', message: '写入失败' })
    assert.equal(s.saving, false)
    assert.equal(s.error, '写入失败')
    assert.equal(s.dirty, true)
    assert.equal(s.draft, '新文案')
  })
  test('discard 还原为 scope 值', () => {
    let s = cardReduce(CARD_INITIAL, scopeEvent('默认'))
    s = cardReduce(s, { kind: 'edit', draft: '新文案' })
    s = cardReduce(s, { kind: 'discard', value: '默认' })
    assert.equal(s.draft, '默认')
    assert.equal(s.dirty, false)
  })
  test('dirty 时 scope 事件不覆盖草稿', () => {
    let s = cardReduce(CARD_INITIAL, scopeEvent('默认'))
    s = cardReduce(s, { kind: 'edit', draft: '我的草稿' })
    s = cardReduce(s, scopeEvent('外部更新'))
    assert.equal(s.draft, '我的草稿', '编辑中不被外部 scope 值覆盖')
    assert.equal(s.dirty, true)
  })
})
