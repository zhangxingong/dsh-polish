/**
 * Client apply — dsh-polish 的 client 半入口。
 * 注册 conversation.input.left（order 31 → 书本图标 deepread order 30 右侧），
 * standard props 直读：useProjection('permissions') / useInput / inputActions。
 * 红线：slots.inject 回调必须返回 register 的 disposer；全部挂 ctx.effect dispose 链。
 */
import { createElement, useRef, useState } from 'react'
import { Toast, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { Context } from 'cordis'
import { decidePolishAction, type PolishAction } from './state.js'
import { postJson, runPolishClick } from './orchestrate.js'
import { StarIcon } from './icon.js'
import { createPolishCardStore, type CardStoreLike, type SettingsScope } from './settings-card-store.js'
import { PolishSettingsCard } from './settings-card.js'
import './star.css'

export const inject = ['slots']

const TOOLTIP = '优化并细化当前用户输入'

interface InputState {
  draft?: string
  phase?: string
}

interface EntryProps {
  useInput: (selector: (state: unknown) => unknown) => unknown
  useProjection: (key: string) => unknown
  inputActions: { setDraft: (text: string) => void }
  [key: string]: unknown
}

interface SlotsService {
  inject(key: string, callback: () => () => void): () => void
  register(options: { name: string; id?: string; key?: string; order?: number; label?: string; inject?: () => unknown }, component: unknown): () => void
}

interface SettingsScopeService {
  bind(options: { namespace: string }): SettingsScope
}

type ClientCtx = Context & { slots: SlotsService; settingsScope?: SettingsScopeService }

/** DOM 锚点：composer textarea 带 data-phase（官方属性）。 */
function findComposerTextarea(): HTMLTextAreaElement | null {
  const active = document.activeElement
  if (active instanceof HTMLTextAreaElement && active.hasAttribute('data-phase')) return active
  return document.querySelector<HTMLTextAreaElement>('textarea[data-phase]')
}

function StarButton(props: EntryProps) {
  const draft = ((props.useInput((s) => (s as InputState | undefined)?.draft ?? '') as string | undefined) ?? '')
  const phase = ((props.useInput((s) => (s as InputState | undefined)?.phase ?? 'plain') as string | undefined) ?? 'plain')
  const permissions = props.useProjection('permissions') as { currentValue?: string } | undefined
  const action: PolishAction = decidePolishAction(permissions?.currentValue, phase, draft)

  const draftRef = useRef(draft)
  draftRef.current = draft

  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<{ seq: number; text: string } | null>(null)
  const disabled = action === 'disabled' || busy

  const focusEnd = (): void => {
    const ta = findComposerTextarea()
    if (ta === null) return
    ta.focus()
    // rAF：等 React 用 setDraft 后的新值重渲染完成再定位（官方 restoreCaret 同款时机）
    requestAnimationFrame(() => {
      const end = ta.value.length
      ta.setSelectionRange(end, end)
    })
  }

  const onClick = (): void => {
    if (disabled) return
    setBusy(true)
    void runPolishClick(action, draft, {
      post: (text) => postJson('/dsh-polish/optimize', { text }),
      setDraft: (text) => props.inputActions.setDraft(text),
      focusEnd,
      notify: (text) => setToast({ seq: Date.now(), text }),
      getCurrentDraft: () => draftRef.current,
    }).catch(() => setToast({ seq: Date.now(), text: '优化失败，请稍后重试' })).finally(() => setBusy(false))
  }

  return createElement(
    'div',
    { className: 'dsh-polish-entry' },
    createElement(
      Tooltip,
      { label: TOOLTIP, side: 'top', delayMs: 500 },
      createElement(
        'button',
        {
          type: 'button',
          className: 'dsh-polish-btn',
          'aria-label': TOOLTIP,
          disabled,
          'data-busy': busy || undefined,
          onClick,
        },
        createElement(StarIcon),
      ),
    ),
    toast !== null && createElement(Toast, { key: toast.seq, text: toast.text, onDone: () => setToast(null) }),
  )
}

export function apply(ctx: ClientCtx): void {
  const offSlot = ctx.slots.inject('conversation.input.left', () =>
    ctx.slots.register(
      { name: 'conversation.input.left', id: 'polish-composer', order: 31, label: TOOLTIP },
      (props: EntryProps) => createElement(StarButton, props),
    ),
  )
  ctx.effect(() => () => {
    offSlot()
  }, 'dsh-polish: client lifecycle (slot entry)')

  // 设置卡片：settingsScope 服务缺失时 scoped fiber 不启动，星按钮主链路不受影响
  ctx.inject(['settingsScope'], (sctx) => {
    const scoped = sctx as ClientCtx
    const scopeService = scoped.settingsScope
    if (scopeService === undefined) return
    const scope = scopeService.bind({ namespace: 'polish' })
    // 平台 d.ts 未声明 set（运行时存在）；CardStoreLike 只要求 set 语义，收窄一次
    const store = createPolishCardStore(scope, (init) => createSnapshotStore(init) as unknown as CardStoreLike)
    const off = scoped.slots.inject('settings.plugin.item', () =>
      scoped.slots.register(
        {
          name: 'settings.plugin.item',
          key: 'polish',
          inject: () => ({
            hooks: { polishCard: store },
            edit: (draft: string) => store.edit(draft),
            save: () => store.save(),
            discard: () => store.discard(),
          }),
        },
        (props: Record<string, unknown>) => createElement(PolishSettingsCard, props as never),
      ),
    )
    return () => {
      off()
    }
  })
}
