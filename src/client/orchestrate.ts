/**
 * 点击编排（纯、可注入）：empty → 提示；ready → 先 resolveImages（失败 notify 不动草稿）
 * → post → 成功 setDraft+focusEnd，失败 notify。
 * postJson 归一所有运输失败为结构化 PolishResult，永不 reject（composer-tools bridgeCore 同款）。
 */
import type { PolishAction } from './state.js'
import type { ImagePayload } from '../optimize.js'

export interface PolishResult {
  ok: boolean
  text?: string
  message?: string
}

export interface HttpLike {
  ok: boolean
  status: number
  json(): Promise<unknown>
}

export type FetchLike = (
  input: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal },
) => Promise<HttpLike>

export async function postJson(path: string, body: unknown, fetchImpl: FetchLike = fetch as unknown as FetchLike): Promise<PolishResult> {
  let res: HttpLike
  try {
    res = await fetchImpl(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
      signal: AbortSignal.timeout(30_000),
    })
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) }
  }
  if (!res.ok) {
    try {
      const parsed = (await res.json()) as { message?: unknown }
      if (typeof parsed === 'object' && parsed !== null && typeof parsed.message === 'string') {
        return { ok: false, message: `请求失败：${parsed.message}` }
      }
    } catch {
      /* 保留默认 message */
    }
    return { ok: false, message: `请求失败（HTTP ${res.status}）` }
  }
  let json: unknown
  try {
    json = await res.json()
  } catch {
    return { ok: false, message: '宿主返回了非 JSON 响应' }
  }
  if (typeof json !== 'object' || json === null) {
    return { ok: false, message: '宿主返回了异常响应' }
  }
  return json as PolishResult
}

export interface PolishGlue {
  post(text: string, images?: ImagePayload[]): Promise<PolishResult>
  setDraft(text: string): void
  focusEnd(): void
  notify(text: string): void
  getCurrentDraft?: () => string
  resolveImages?: () => Promise<ImagePayload[]>
}

export const EMPTY_HINT = '请先输入内容再进行优化细化'

export async function runPolishClick(action: PolishAction, draft: string, glue: PolishGlue): Promise<void> {
  if (action === 'empty') {
    glue.notify(EMPTY_HINT)
    return
  }
  if (action !== 'ready') return
  let images: ImagePayload[] = []
  if (glue.resolveImages !== undefined) {
    try {
      images = await glue.resolveImages()
    } catch (err) {
      glue.notify(err instanceof Error ? err.message : String(err))
      return
    }
  }
  const result = await glue.post(draft, images)
  if (result.ok && typeof result.text === 'string' && result.text.trim().length > 0) {
    const current = glue.getCurrentDraft?.()
    if (current !== undefined && current !== draft) {
      glue.notify('输入已变化，未覆盖')
      return
    }
    glue.setDraft(result.text)
    glue.focusEnd()
  } else {
    glue.notify(result.message ?? '优化失败，请稍后重试')
  }
}
