// 白盒单测：settings-card-store（lib/settings-card-store.js 真实实现，注入 fake scope + fake store）
//
// 回归钉子：fake store 的 update() 复刻真实 createSnapshotStore 的 immer 包装语义
// （mutator 返回值被丢弃、只采纳 draft 原地变更）。2026-09-02 线上 bug：卡片 store
// 用 update + 纯 reducer，状态永远冻结在初始态，默认提示词不显示。
import test from 'node:test'
import assert from 'node:assert/strict'
import { createPolishCardStore } from '../../lib/settings-card-store.js'

const DEFAULT_PROMPT = '默认提示词'

/** 复刻平台 store：set 替换全量状态并通知；update 丢弃 mutator 返回值（immer 契约）。 */
function makeFakeStore(init) {
  let state = init
  const listeners = new Set()
  return {
    getSnapshot: () => state,
    subscribe: (fn) => {
      listeners.add(fn)
      return () => {
        listeners.delete(fn)
      }
    },
    set: (next) => {
      state = next
      for (const fn of [...listeners]) fn(state)
    },
    update: (mutator) => {
      const draft = structuredClone(state)
      mutator(draft) // 返回值丢弃 = 真实 createSnapshotStore 的 produce 包装语义
    },
  }
}

/** 可变的 fake settingsScope：set/unset 改快照并通知订阅者。 */
function makeScope(snap) {
  let current = snap
  const listeners = new Set()
  const notify = () => {
    for (const fn of [...listeners]) fn(current)
  }
  return {
    getSnapshot: () => current,
    subscribe: (fn) => {
      listeners.add(fn)
      return () => {
        listeners.delete(fn)
      }
    },
    set: async (field, value) => {
      current = { ...current, user: { ...(current.user ?? {}), [field]: value } }
      notify()
    },
    unset: async (field) => {
      const user = { ...(current.user ?? {}) }
      delete user[field]
      current = { ...current, user }
      notify()
    },
  }
}

test.describe('createPolishCardStore', () => {
  test('初始同步：ready scope 的 value 写入草稿（回归：走 update 会卡 loading）', () => {
    const store = createPolishCardStore(
      makeScope({ status: 'ready', value: { systemPrompt: DEFAULT_PROMPT }, writable: true }),
      makeFakeStore,
    )
    const snap = store.getSnapshot()
    assert.equal(snap.status, 'ready')
    assert.equal(snap.draft, DEFAULT_PROMPT)
    assert.equal(snap.dirty, false)
  })
  test('value 缺失时回退 base', () => {
    const store = createPolishCardStore(
      makeScope({ status: 'ready', value: {}, base: { systemPrompt: DEFAULT_PROMPT }, writable: true }),
      makeFakeStore,
    )
    assert.equal(store.getSnapshot().draft, DEFAULT_PROMPT)
  })
  test('edit → dirty；scope 事件不覆盖脏草稿', () => {
    const scope = makeScope({ status: 'ready', value: { systemPrompt: DEFAULT_PROMPT }, writable: true })
    const store = createPolishCardStore(scope, makeFakeStore)
    store.edit('我的自定义')
    assert.equal(store.getSnapshot().dirty, true)
    scope.set('systemPrompt', '别处改的')
    assert.equal(store.getSnapshot().draft, '我的自定义')
  })
  test('save 成功 → dirty 清、saved 置位', async () => {
    const scope = makeScope({ status: 'ready', value: { systemPrompt: DEFAULT_PROMPT }, writable: true })
    const store = createPolishCardStore(scope, makeFakeStore)
    store.edit('新提示')
    await store.save()
    const snap = store.getSnapshot()
    assert.equal(snap.saved, true)
    assert.equal(snap.dirty, false)
    assert.equal(snap.draft, '新提示')
  })
  test('空草稿 save → unset 回退默认', async () => {
    const scope = makeScope({ status: 'ready', value: { systemPrompt: '用户旧值' }, user: { systemPrompt: '用户旧值' }, writable: true })
    const store = createPolishCardStore(scope, makeFakeStore)
    store.edit('   ')
    await store.save()
    assert.equal(scope.getSnapshot().user?.systemPrompt, undefined)
  })
  test('save 抛错 → save-fail、dirty 保留', async () => {
    const scope = makeScope({ status: 'ready', value: { systemPrompt: DEFAULT_PROMPT }, writable: true })
    scope.set = async () => {
      throw new Error('boom')
    }
    const store = createPolishCardStore(scope, makeFakeStore)
    store.edit('新提示')
    await store.save()
    const snap = store.getSnapshot()
    assert.equal(snap.error, '设置写入失败')
    assert.equal(snap.dirty, true)
  })
  test('discard 还原 scope 当前值', () => {
    const scope = makeScope({ status: 'ready', value: { systemPrompt: DEFAULT_PROMPT }, writable: true })
    const store = createPolishCardStore(scope, makeFakeStore)
    store.edit('乱改')
    store.discard()
    assert.equal(store.getSnapshot().draft, DEFAULT_PROMPT)
  })
})
