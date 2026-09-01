declare module '*.css'

declare module '@deepseek-ai/dsh-client-ui-primitives' {
  import type { ReactNode } from 'react'
  export const Toast: (props: { text: string; icon?: ReactNode; anchor?: Element | null; onDone: () => void }) => ReactNode
  export const Tooltip: (props: { label: string; side?: 'top' | 'bottom' | 'left' | 'right'; delayMs?: number; children?: ReactNode }) => ReactNode
}
