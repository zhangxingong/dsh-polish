/** 卡片草稿状态机（纯 reducer，供组件与单测共用）。 */

export type CardStatus = 'loading' | 'ready' | 'unavailable'

export interface CardState {
  status: CardStatus
  draft: string
  dirty: boolean
  saving: boolean
  saved: boolean
  error: string | null
  writable: boolean
}

export type CardEvent =
  | { kind: 'scope'; status: CardStatus; value: string; writable: boolean }
  | { kind: 'edit'; draft: string }
  | { kind: 'save-start' }
  | { kind: 'save-ok' }
  | { kind: 'save-fail'; message: string }
  | { kind: 'discard'; value: string }

export const CARD_INITIAL: CardState = { status: 'loading', draft: '', dirty: false, saving: false, saved: false, error: null, writable: true }

export function cardReduce(state: CardState, event: CardEvent): CardState {
  switch (event.kind) {
    case 'scope':
      // ready 且未编辑过 → 用 scope 值初始化草稿；unavailable → 禁用
      return {
        ...state,
        status: event.status,
        writable: event.writable && event.status === 'ready',
        draft: state.dirty ? state.draft : event.value,
      }
    case 'edit':
      return { ...state, draft: event.draft, dirty: true, saved: false, error: null }
    case 'save-start':
      return { ...state, saving: true, saved: false, error: null }
    case 'save-ok':
      return { ...state, saving: false, saved: true, dirty: false }
    case 'save-fail':
      return { ...state, saving: false, error: event.message }
    case 'discard':
      return { ...state, draft: event.value, dirty: false, saved: false, error: null }
    default:
      return state
  }
}
