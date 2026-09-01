/** 按钮三态判定（纯函数，供组件与单测共用）。 */

export type PolishAction = 'disabled' | 'empty' | 'ready'

export function decidePolishAction(permission: string | undefined, phase: string, draft: string): PolishAction {
  if (permission === 'read-only' || phase === 'submitting' || phase === 'adjudicating') return 'disabled'
  if (draft.trim() === '') return 'empty'
  return 'ready'
}
