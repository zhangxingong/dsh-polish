/**
 * 「个性化优化」设置卡片的 store（纯逻辑，store 工厂可注入供 node 测试）。
 * 平台契约：createSnapshotStore.update 是 immer 包装（mutator 返回值被丢弃，
 * 只采纳 draft 原地变更）——纯 reducer 与它不兼容，本模块一律走 set(nextState)。
 */
import { CARD_INITIAL, cardReduce, type CardEvent, type CardState, type CardStatus } from './settings-state.js'

export interface SettingsSnapshot {
  status: CardStatus
  value?: { systemPrompt?: string }
  base?: { systemPrompt?: string }
  user?: { systemPrompt?: string }
  writable: boolean
}

export interface SettingsScope {
  getSnapshot(): SettingsSnapshot
  subscribe(listener: (snapshot: SettingsSnapshot) => void): () => void
  set(field: string, value: string): Promise<unknown>
  unset(field: string): Promise<unknown>
}

export interface CardStoreLike {
  getSnapshot(): CardState
  set(next: CardState): void
  subscribe(listener: () => void): () => void
}

export interface PolishCardStore {
  getSnapshot(): CardState
  subscribe(listener: () => void): () => void
  edit(draft: string): void
  save(): Promise<void>
  discard(): void
}

function scopePrompt(snap: SettingsSnapshot): string {
  return snap.value?.systemPrompt ?? snap.base?.systemPrompt ?? ''
}

export function createPolishCardStore(scope: SettingsScope, makeStore: (init: CardState) => CardStoreLike): PolishCardStore {
  const store = makeStore(CARD_INITIAL)
  const dispatch = (event: CardEvent): void => {
    store.set(cardReduce(store.getSnapshot(), event))
  }
  const dispatchScope = (snap: SettingsSnapshot): void => {
    dispatch({
      kind: 'scope',
      status: snap.status,
      value: scopePrompt(snap),
      writable: snap.writable,
    })
  }
  // 初始同步一次：scope 已 ready 时（先加载完再进设置页）不会再收到后续事件，避免卡片卡在 loading
  dispatchScope(scope.getSnapshot())
  scope.subscribe(dispatchScope)

  return {
    getSnapshot: store.getSnapshot,
    subscribe: store.subscribe,
    edit: (draft) => dispatch({ kind: 'edit', draft }),
    save: async () => {
      const draft = store.getSnapshot().draft
      dispatch({ kind: 'save-start' })
      const target = draft.trim()
      let ok = false
      try {
        if (target === '') {
          // 空草稿保存 = unset，回退默认
          await scope.unset('systemPrompt')
          ok = scope.getSnapshot().user?.systemPrompt === undefined
        } else {
          await scope.set('systemPrompt', target)
          ok = scope.getSnapshot().user?.systemPrompt === target
        }
      } catch {
        ok = false
      }
      dispatch(ok ? { kind: 'save-ok' } : { kind: 'save-fail', message: '设置写入失败' })
    },
    discard: () => dispatch({ kind: 'discard', value: scopePrompt(scope.getSnapshot()) }),
  }
}
