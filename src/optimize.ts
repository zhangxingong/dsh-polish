/**
 * 优化细化的 DeepSeek 直连层。纯函数 + 注入 fetch/resolveApiKey，可在 node --test 驱动。
 * 错误统一为 OptimizeError（code 供 handler 映射 HTTP 语义）。
 */

export type OptimizeErrorCode = 'missing-credential' | 'transport' | 'api-error' | 'empty-response'

export class OptimizeError extends Error {
  constructor(
    public readonly code: OptimizeErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options)
    this.name = 'OptimizeError'
  }
}

export const MODEL = 'deepseek-v4-flash'
export const BASE_URL = 'https://api.deepseek.com'
export const MAX_OUTPUT_TOKENS = 8192

export const SYSTEM_PROMPT = [
  '你是文本优化助手。请对用户提供的文本进行优化与细化：',
  '1. 保留用户原本的核心想法与意图，不得篡改原意；',
  '2. 理顺语句逻辑，修正语病，删除冗余废话；',
  '3. 补充缺失细节，扩充描述层次，使表达更完整、严谨、条理清晰；',
  '4. 维持原有语气风格，不强行改变文体。',
  '只输出优化后的完整文本，不要输出任何解释、标题或前后缀。',
].join('\n')

export function buildOptimizePrompt(text: string, systemPrompt: string = SYSTEM_PROMPT) {
  return {
    model: MODEL,
    temperature: 0.3,
    stream: false,
    max_tokens: Math.min(Math.max(1024, Math.ceil(text.length * 2) + 512), MAX_OUTPUT_TOKENS),
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: text },
    ],
  }
}

export interface OptimizeDeps {
  fetchImpl?: typeof fetch
  resolveApiKey?: () => Promise<string>
  systemPrompt?: string
}

async function ambientApiKey(): Promise<string> {
  const value = process.env.DEEPSEEK_API_KEY
  if (value !== undefined && value.length > 0) return value
  throw new OptimizeError(
    'missing-credential',
    'dsh-polish: no API key "DEEPSEEK_API_KEY" — store it through the credentials service or set the DEEPSEEK_API_KEY environment variable',
  )
}

export async function callDeepSeekOptimize(text: string, deps: OptimizeDeps = {}): Promise<string> {
  const fetchImpl = deps.fetchImpl ?? fetch
  const resolveApiKey = deps.resolveApiKey ?? ambientApiKey
  const systemPrompt = (deps.systemPrompt ?? '').trim() || SYSTEM_PROMPT
  let apiKey: string
  try {
    apiKey = await resolveApiKey()
  } catch (err) {
    if (err instanceof OptimizeError) throw err
    throw new OptimizeError('missing-credential', err instanceof Error ? err.message : String(err), { cause: err })
  }
  let res: Response
  try {
    res = await fetchImpl(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify(buildOptimizePrompt(text, systemPrompt)),
      signal: AbortSignal.timeout(30_000),
    })
  } catch (err) {
    throw new OptimizeError('transport', `DeepSeek API request failed: ${err instanceof Error ? err.message : String(err)}`, { cause: err })
  }
  if (!res.ok) {
    let message = `DeepSeek API error (HTTP ${res.status})`
    try {
      const payload = (await res.json()) as { error?: { message?: string } }
      if (payload?.error?.message) message = payload.error.message
    } catch {
      /* 保留默认 message */
    }
    throw new OptimizeError('api-error', message)
  }
  let payload: unknown
  try {
    payload = await res.json()
  } catch (err) {
    throw new OptimizeError('api-error', 'DeepSeek API returned a non-JSON body', { cause: err })
  }
  const content = (payload as { choices?: Array<{ message?: { content?: unknown } }> })?.choices?.[0]?.message?.content
  if (typeof content !== 'string' || content.trim() === '') {
    throw new OptimizeError('empty-response', 'DeepSeek API returned no content')
  }
  return content
}
