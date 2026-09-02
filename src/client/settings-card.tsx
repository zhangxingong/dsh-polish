/**
 * 「个性化优化」设置卡片：controller（createPolishCardStore）+ 组件。
 * 草稿状态机见 settings-state.ts（纯 reducer）；scope 来自 settingsScope.bind({namespace:'polish'})。
 * 类型全部结构化；仅 import @deepseek-ai/dsh-client-runtime/client（平台 external）。
 */
import { createElement, type ChangeEvent, type ReactNode } from 'react'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { CARD_INITIAL, cardReduce, type CardState, type CardStatus } from './settings-state.js'
import './settings-card.css'

const CARD_TITLE = '个性化优化'

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

export interface PolishCardStore {
  getSnapshot(): CardState
  subscribe(listener: (snapshot: CardState) => void): () => void
  edit(draft: string): void
  save(): Promise<void>
  discard(): void
}

function scopePrompt(snap: SettingsSnapshot): string {
  return snap.value?.systemPrompt ?? snap.base?.systemPrompt ?? ''
}

export function createPolishCardStore(scope: SettingsScope): PolishCardStore {
  const store: SnapshotStore<CardState> = createSnapshotStore(CARD_INITIAL)
  const dispatchScope = (snap: SettingsSnapshot): void => {
    store.update((state) => cardReduce(state, {
      kind: 'scope',
      status: snap.status,
      value: scopePrompt(snap),
      writable: snap.writable,
    }))
  }
  // 初始同步一次：scope 已 ready 时（先加载完再进设置页）不会再收到后续事件，避免卡片卡在 loading
  dispatchScope(scope.getSnapshot())
  scope.subscribe(dispatchScope)

  return {
    getSnapshot: store.getSnapshot,
    subscribe: store.subscribe,
    edit: (draft) => store.update((state) => cardReduce(state, { kind: 'edit', draft })),
    save: async () => {
      const draft = store.getSnapshot().draft
      store.update((state) => cardReduce(state, { kind: 'save-start' }))
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
      store.update((state) => cardReduce(state, ok ? { kind: 'save-ok' } : { kind: 'save-fail', message: '设置写入失败' }))
    },
    discard: () => store.update((state) => cardReduce(state, { kind: 'discard', value: scopePrompt(scope.getSnapshot()) })),
  }
}

interface PolishSettingsCardProps {
  usePolishCard: (selector: (state: CardState) => CardState) => CardState
  edit: (draft: string) => void
  save: () => Promise<void> | void
  discard: () => void
}

export function PolishSettingsCard(props: PolishSettingsCardProps): ReactNode {
  const snap = props.usePolishCard((s) => s)
  const locked = snap.saving || snap.status === 'unavailable' || !snap.writable
  const canSave = !snap.saving && snap.dirty
  const canDiscard = !snap.saving && (snap.dirty || snap.error !== null)

  let statusLine: ReactNode = null
  if (snap.saved) statusLine = createElement('span', { className: 'dsh-polish-settings-status saved' }, '已保存')
  else if (snap.error !== null) statusLine = createElement('span', { className: 'dsh-polish-settings-status error' }, `保存失败：${snap.error}`)
  else if (snap.status === 'loading') statusLine = createElement('span', { className: 'dsh-polish-settings-status muted' }, '加载中…')

  return createElement(
    'section',
    { className: 'dsh-polish-settings' },
    createElement('h3', { className: 'dsh-polish-settings-title' }, CARD_TITLE),
    createElement('textarea', {
      className: 'dsh-polish-settings-textarea',
      rows: 12,
      value: snap.draft,
      disabled: locked,
      onChange: (event: ChangeEvent<HTMLTextAreaElement>) => props.edit(event.target.value),
    }),
    createElement(
      'div',
      { className: 'dsh-polish-settings-row' },
      createElement(
        'button',
        { type: 'button', className: 'dsh-polish-settings-save', disabled: !canSave, onClick: () => void props.save() },
        '保存',
      ),
      createElement(
        'button',
        { type: 'button', className: 'dsh-polish-settings-discard', disabled: !canDiscard, onClick: () => props.discard() },
        '放弃',
      ),
      statusLine,
    ),
  )
}
