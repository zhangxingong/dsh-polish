// 白盒单测：state（lib/state.js 真实实现）
import test from 'node:test'
import assert from 'node:assert/strict'
import { decidePolishAction } from '../../lib/state.js'

test.describe('decidePolishAction', () => {
  test('read-only 权限 → disabled', () => {
    assert.equal(decidePolishAction('read-only', 'plain', '有内容'), 'disabled')
  })
  test('submitting 阶段 → disabled（防发送中替换草稿）', () => {
    assert.equal(decidePolishAction('danger-full-access', 'submitting', '有内容'), 'disabled')
  })
  test('adjudicating 阶段 → disabled', () => {
    assert.equal(decidePolishAction('workspace-write', 'adjudicating', '有内容'), 'disabled')
  })
  test('权限未定义（容错）→ 不因缺失而 disabled', () => {
    assert.equal(decidePolishAction(undefined, 'plain', '有内容'), 'ready')
  })
  test('空草稿 → empty（空白也算空）', () => {
    assert.equal(decidePolishAction('danger-full-access', 'plain', ''), 'empty')
    assert.equal(decidePolishAction('danger-full-access', 'plain', '   \n '), 'empty')
  })
  test('正常 → ready', () => {
    assert.equal(decidePolishAction('danger-full-access', 'plain', ' 你好 '), 'ready')
  })
})
