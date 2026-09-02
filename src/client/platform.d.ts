declare module '*.css'

declare module '@deepseek-ai/dsh-client-ui-primitives' {
  import type { ReactNode } from 'react'
  export const Toast: (props: { text: string; icon?: ReactNode; anchor?: Element | null; onDone: () => void }) => ReactNode
  export const Tooltip: (props: { label: string; side?: 'top' | 'bottom' | 'left' | 'right'; delayMs?: number; children?: ReactNode }) => ReactNode
}

declare module '@deepseek-ai/dsh-client-runtime/client' {
  export interface SnapshotStore<T> {
    getSnapshot(): T
    subscribe(listener: (snapshot: T) => void): () => void
    update(mutator: (draft: T) => void | T): void
  }
  export function createSnapshotStore<T>(init: T, options?: unknown): SnapshotStore<T>
}
