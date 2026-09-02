/**
 * 「个性化优化」设置卡片组件。store 逻辑见 settings-card-store.ts（纯模块，node 可测）。
 * 类型全部结构化；无 @deepseek-ai value import。
 */
import { createElement, type ChangeEvent, type ReactNode } from 'react'
import type { CardState } from './settings-state.js'
import './settings-card.css'

const CARD_TITLE = '个性化优化'

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
