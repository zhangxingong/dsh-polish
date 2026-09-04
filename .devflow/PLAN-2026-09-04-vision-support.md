# dsh-polish 视觉支持 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 四角星优化按钮改用 `deepseek-v4-flash-vision-exp`，识别 composer 附件栏已上传的图片与文本中的公网图片链接。

**Architecture:** 客户端从输入状态读 `imageIds`，经 `conversation` 服务 `serializeDraftImages()` 转 base64 载荷随 POST 发送；宿主端把文本 + data URI 图块 + 链接图块组装成 vision content 数组直连 DeepSeek。链接由模型侧自动下载（不 host 下载）。

**Tech Stack:** TypeScript（tsdown 构建 → lib/）、node --test、DeepSeek OpenAI 兼容 chat/completions、cordis client（`ctx.inject(['conversation'])`）。

**Spec:** `packages/dsh-polish/.devflow/DESIGN-2026-09-04-vision-support.md`（2026-09-04，已批准）

## Global Constraints

- 模型 id 精确为 `deepseek-v4-flash-vision-exp`（DeepSeek 唯一视觉模型）
- 图片 mediaType 白名单：`image/png`、`image/jpeg`、`image/webp`、`image/gif`
- 限额：请求体 ≤ 48MB（48 * 1024 * 1024）、单图 base64 解码后 ≤ 32MB、≤ 20 张/请求
- 图片只放 user 消息；system 提示词、temperature 0.3、非流式、max_tokens clamp、30s AbortSignal 全部不变
- 文本校验不变：text 非字符串/空白/超 200KB 的判定与错误码不变
- 链接提取正则（只认明显图片扩展）：`/https?:\/\/[^\s"'<>]+\.(?:png|jpe?g|gif|webp)(?:\?[^\s"'<>]*)?/gi`；提取后保留在文本中
- 图片附件只随请求读取，成功覆盖只改文本草稿，图片附件保留原样
- 无新增依赖；测试框架 node --test（既有 70 单测保持全绿）
- 每个任务结束提交一次（git add 指定文件，不 `git add -A`）
- 包内命令：`pnpm check`（tsc 双配置类型检查）、`pnpm test`（pretest 自动构建 lib/）、`pnpm build`

---

### Task 1: optimize.ts 视觉模型与 content 块

**Files:**
- Modify: `packages/dsh-polish/src/optimize.ts`（全文）
- Test: `packages/dsh-polish/tests/unit/optimize.unit.test.mjs`

**Interfaces:**
- Produces（后续任务依赖）:
  - `export const MODEL = 'deepseek-v4-flash-vision-exp'`
  - `export interface ImagePayload { mediaType: string; data: string }`
  - `export function extractImageLinks(text: string): string[]`
  - `export type UserContentBlock = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }`
  - `export function buildOptimizePrompt(text: string, images?: ImagePayload[], systemPrompt?: string)`
  - `OptimizeDeps` 增加 `images?: ImagePayload[]`；`callDeepSeekOptimize(text, deps)` 读 `deps.images`

- [ ] **Step 1: 写失败测试**

`tests/unit/optimize.unit.test.mjs` 两处既有断言更新（user content 变为块数组；systemPrompt 变第 3 参）：

```js
  test('system 含四条优化规则与只输出正文约束', () => {
    const p = buildOptimizePrompt('你好')
    const s = p.messages[0].content
    for (const kw of ['核心想法', '语病', '冗余', '细节', '语气风格', '只输出优化后的完整文本']) {
      assert.ok(s.includes(kw), `system 应包含「${kw}」`)
    }
    assert.deepEqual(p.messages[1], { role: 'user', content: [{ type: 'text', text: '你好' }] })
  })
  test('自定义 systemPrompt 透传', () => {
    const p = buildOptimizePrompt('x', [], '自定义提示')
    assert.equal(p.messages[0].content, '自定义提示')
  })
```

文件末尾新增 describe 块：

```js
test.describe('buildOptimizePrompt vision', () => {
  test('MODEL 为 vision 模型', () => {
    assert.equal(MODEL, 'deepseek-v4-flash-vision-exp')
  })
  test('上传图 → data URI image_url 块', () => {
    const p = buildOptimizePrompt('看图', [{ mediaType: 'image/png', data: 'aGVsbG8=' }])
    assert.deepEqual(p.messages[1].content[1], { type: 'image_url', image_url: { url: 'data:image/png;base64,aGVsbG8=' } })
  })
  test('文本内图片链接 → image_url 块，链接保留在文本中', () => {
    const p = buildOptimizePrompt('见图 https://cdn.example.com/a.png 谢谢')
    assert.deepEqual(p.messages[1].content, [
      { type: 'text', text: '见图 https://cdn.example.com/a.png 谢谢' },
      { type: 'image_url', image_url: { url: 'https://cdn.example.com/a.png' } },
    ])
  })
  test('多链接、大小写扩展名与 query 参数', () => {
    const p = buildOptimizePrompt('https://a.com/1.JPG?x=1 和 http://b.com/t.gif')
    assert.deepEqual(p.messages[1].content.slice(1), [
      { type: 'image_url', image_url: { url: 'https://a.com/1.JPG?x=1' } },
      { type: 'image_url', image_url: { url: 'http://b.com/t.gif' } },
    ])
  })
  test('无扩展名图片 URL 不提取', () => {
    const p = buildOptimizePrompt('看 https://example.com/photo?id=3')
    assert.equal(p.messages[1].content.length, 1)
  })
  test('普通网页链接不提取', () => {
    const p = buildOptimizePrompt('看 https://example.com/page')
    assert.equal(p.messages[1].content.length, 1)
  })
  test('混合：上传图在前，链接在后', () => {
    const p = buildOptimizePrompt('见图 https://a.com/x.png', [{ mediaType: 'image/jpeg', data: 'eA==' }])
    assert.deepEqual(p.messages[1].content.slice(1), [
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,eA==' } },
      { type: 'image_url', image_url: { url: 'https://a.com/x.png' } },
    ])
  })
  test('callDeepSeekOptimize 经 deps.images 透传 → 请求体 content 带图块', async () => {
    await callDeepSeekOptimize('x', {
      fetchImpl: fakeFetch(200, { choices: [{ message: { content: '优化后' } }] }),
      resolveApiKey: async () => 'sk-test',
      images: [{ mediaType: 'image/webp', data: 'aGk=' }],
    })
    const body = JSON.parse(calls[0].init.body)
    assert.deepEqual(body.messages[1].content, [
      { type: 'text', text: 'x' },
      { type: 'image_url', image_url: { url: 'data:image/webp;base64,aGk=' } },
    ])
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/dsh-polish && pnpm test 2>&1 | Select-String -Pattern "fail|pass" | Select-Object -Last 3`
Expected: 失败（`p.messages[1]` 是字符串而非块数组、`MODEL !== 'deepseek-v4-flash-vision-exp'`）

- [ ] **Step 3: 实现**

`src/optimize.ts` 全量替换为：

```ts
/**
 * 优化细化的 DeepSeek 直连层。纯函数 + 注入 fetch/resolveApiKey，可在 node --test 驱动。
 * 错误统一为 OptimizeError（code 供 handler 映射 HTTP 语义）。
 * vision：user 消息 content 为块数组——文本块 + 上传图 data URI 块 + 文本内图片链接块（模型侧自动下载）。
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

export const MODEL = 'deepseek-v4-flash-vision-exp'
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

export interface ImagePayload {
  mediaType: string
  data: string
}

export const IMAGE_LINK_RE = /https?:\/\/[^\s"'<>]+\.(?:png|jpe?g|gif|webp)(?:\?[^\s"'<>]*)?/gi

export function extractImageLinks(text: string): string[] {
  const matches = text.match(IMAGE_LINK_RE)
  return matches ?? []
}

export type UserContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

export function buildOptimizePrompt(text: string, images: ImagePayload[] = [], systemPrompt: string = SYSTEM_PROMPT) {
  const content: UserContentBlock[] = [
    { type: 'text', text },
    ...images.map((image) => ({
      type: 'image_url' as const,
      image_url: { url: `data:${image.mediaType};base64,${image.data}` },
    })),
    ...extractImageLinks(text).map((url) => ({
      type: 'image_url' as const,
      image_url: { url },
    })),
  ]
  return {
    model: MODEL,
    temperature: 0.3,
    stream: false,
    max_tokens: Math.min(Math.max(1024, Math.ceil(text.length * 2) + 512), MAX_OUTPUT_TOKENS),
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content },
    ],
  }
}

export interface OptimizeDeps {
  fetchImpl?: typeof fetch
  resolveApiKey?: () => Promise<string>
  systemPrompt?: string
  images?: ImagePayload[]
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
      body: JSON.stringify(buildOptimizePrompt(text, deps.images ?? [], systemPrompt)),
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
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test 2>&1 | Select-String -Pattern "# pass|# fail" | Select-Object -Last 2`
Expected: `# fail 0`（pass 数 ≥ 80）

- [ ] **Step 5: 提交**

```bash
cd packages/dsh-polish && git add src/optimize.ts tests/unit/optimize.unit.test.mjs lib/optimize.js
git commit -m "feat(dsh-polish): vision model deepseek-v4-flash-vision-exp with content blocks"
```

---

### Task 2: handler.ts 图片校验与透传

**Files:**
- Modify: `packages/dsh-polish/src/handler.ts`（全文）
- Test: `packages/dsh-polish/tests/unit/handler.unit.test.mjs`

**Interfaces:**
- Consumes: Task 1 的 `ImagePayload`、`callDeepSeekOptimize`
- Produces:
  - `export const MAX_BODY_BYTES = 48 * 1024 * 1024`
  - `export const MAX_IMAGES_PER_REQUEST = 20`、`export const MAX_IMAGE_BYTES = 32 * 1024 * 1024`
  - `export type OptimizeFn = (text: string, images?: ImagePayload[]) => Promise<string>`

- [ ] **Step 1: 写失败测试**

`tests/unit/handler.unit.test.mjs` 一处既有断言更新（413 阈值随新 body 上限变化）：

```js
  test('413：content-length 预声明超限', async () => {
    const { baseUrl, close } = await serve(async (t) => t)
    const { port } = new URL(baseUrl)
    const res = await new Promise((resolve, reject) => {
      const req = http.request(
        { host: '127.0.0.1', port, path: '/dsh-polish/optimize', method: 'POST', headers: { 'content-type': 'application/json', 'content-length': '50331649' } },
        (r) => { let b = ''; r.on('data', (c) => (b += c)); r.on('end', () => resolve({ status: r.statusCode, body: b })) },
      )
      req.on('error', reject)
      req.end(JSON.stringify({ text: 'x' }))
    })
    assert.equal(res.status, 413)
    await close()
  })
```

文件末尾（`test.describe` 内）新增用例：

```js
  test('200：images 透传给 optimize', async () => {
    let seen
    const { baseUrl, close } = await serve(async (text, images) => { seen = { text, images }; return 'OPT' })
    const res = await post(baseUrl, { text: 'x', images: [{ mediaType: 'image/png', data: 'aGk=' }] })
    assert.equal(res.status, 200)
    assert.deepEqual(seen, { text: 'x', images: [{ mediaType: 'image/png', data: 'aGk=' }] })
    await close()
  })
  test('images 缺省 → optimize 收到空数组', async () => {
    let seen
    const { baseUrl, close } = await serve(async (text, images) => { seen = images; return 'OPT' })
    const res = await post(baseUrl, { text: 'x' })
    assert.equal(res.status, 200)
    assert.deepEqual(seen, [])
    await close()
  })
  test('400：images 非数组 → invalid-images', async () => {
    const { baseUrl, close } = await serve(async (t) => t)
    const res = await post(baseUrl, { text: 'x', images: 'nope' })
    assert.equal(res.status, 400)
    assert.deepEqual((await res.json()).code, 'invalid-images')
    await close()
  })
  test('400：非法图片项 → invalid-image', async () => {
    const { baseUrl, close } = await serve(async (t) => t)
    const res = await post(baseUrl, { text: 'x', images: [{ mediaType: 'image/bmp', data: 'aGk=' }] })
    assert.equal(res.status, 400)
    assert.deepEqual((await res.json()).code, 'invalid-image')
    await close()
  })
  test('400：超 20 张 → too-many-images', async () => {
    const { baseUrl, close } = await serve(async (t) => t)
    const many = Array.from({ length: 21 }, () => ({ mediaType: 'image/png', data: 'aGk=' }))
    const res = await post(baseUrl, { text: 'x', images: many })
    assert.equal(res.status, 400)
    assert.deepEqual((await res.json()).code, 'too-many-images')
    await close()
  })
  test('400：单图 base64 解码超 32MB → image-too-large', async () => {
    const { baseUrl, close } = await serve(async (t) => t)
    const big = { mediaType: 'image/png', data: Buffer.alloc(33 * 1024 * 1024).toString('base64') }
    const res = await post(baseUrl, { text: 'x', images: [big] })
    assert.equal(res.status, 400)
    assert.deepEqual((await res.json()).code, 'image-too-large')
    await close()
  })
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test 2>&1 | Select-String -Pattern "fail \d+" | Select-Object -Last 1`
Expected: 新增用例失败（旧 handler 忽略 images → 200 而非 400/透传断言失败）

- [ ] **Step 3: 实现**

`src/handler.ts` 全量替换为：

```ts
/**
 * /dsh-polish/* RPC 面。判定顺序 = 传输契约：
 *   1 trust fence → 403 plain 'forbidden'
 *   2 非 POST → 405（allow: POST）
 *   3 路径非 /dsh-polish/optimize → 404
 *   4 body > 48MB → 413；读取失败 → 400；非法 JSON → 400
 *   5 text 非字符串 → 400 invalid-text；空白 → 400 empty-text；> 200KB → 400 text-too-large
 *   6 images 非数组 → 400 invalid-images；> 20 张 → 400 too-many-images；
 *     项非 {mediaType(白名单), data} → 400 invalid-image；单图解码 > 32MB → 400 image-too-large
 *   7 optimize 抛 OptimizeError → 502 透传 code/message；未知错误 → 502 internal-error
 * 异步 handler 永不 reject；ctx.logger 现取现用。
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from 'cordis'
import { isTrustedPolishRequest } from './trust-fence.js'
import { callDeepSeekOptimize, OptimizeError } from './optimize.js'
import type { ImagePayload } from './optimize.js'

export const MAX_BODY_BYTES = 48 * 1024 * 1024
export const MAX_TEXT_BYTES = 200 * 1024
export const MAX_IMAGES_PER_REQUEST = 20
export const MAX_IMAGE_BYTES = 32 * 1024 * 1024
const ACCEPTED_IMAGE_MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']

export type OptimizeFn = (text: string, images?: ImagePayload[]) => Promise<string>

export interface PolishHandlerOptions {
  /** 注入替身（测试）；缺省走真实 DeepSeek 直连。 */
  optimize?: OptimizeFn
}

export type PolishHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void>

function sendJson(res: ServerResponse, status: number, json: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(json))
}

function sendPlain(res: ServerResponse, status: number, text: string, extraHeaders: Record<string, string> = {}): void {
  res.writeHead(status, extraHeaders)
  res.end(text)
}

export type BodyRead =
  | { ok: true; body: string }
  | { ok: false; code: 'read-failed' }
  | { ok: false; code: 'too-large' }

/** 消费请求体，字节精确（多字节 UTF-8 不会滑过上限）。永不 reject。 */
export async function readRequestBody(req: IncomingMessage, limit: number = MAX_BODY_BYTES): Promise<BodyRead> {
  const declared = Number(req.headers['content-length'])
  if (Number.isFinite(declared) && declared > limit) return { ok: false, code: 'too-large' }
  try {
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of req) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += buf.byteLength
      if (size > limit) return { ok: false, code: 'too-large' }
      chunks.push(buf)
    }
    return { ok: true, body: Buffer.concat(chunks).toString('utf8') }
  } catch {
    return { ok: false, code: 'read-failed' }
  }
}

export function createPolishHandler(ctx: Context, opts: PolishHandlerOptions = {}): PolishHandler {
  const optimize = opts.optimize ?? ((text: string, images: ImagePayload[] = []) => callDeepSeekOptimize(text, { images }))
  return async (req, res) => {
    try {
      if (!isTrustedPolishRequest(req)) {
        sendPlain(res, 403, 'forbidden')
        return
      }
      if (req.method !== 'POST') {
        sendPlain(res, 405, 'method not allowed', { allow: 'POST' })
        return
      }
      const pathname = (req.url ?? '').split('?')[0]
      if (pathname !== '/dsh-polish/optimize') {
        sendPlain(res, 404, 'not found')
        return
      }
      const read = await readRequestBody(req)
      if (!read.ok) {
        if (read.code === 'read-failed') {
          sendJson(res, 400, { ok: false, code: 'bad-request', message: 'request body read failed' })
          return
        }
        sendJson(res, 413, { ok: false, code: 'payload-too-large', message: `request body exceeds ${MAX_BODY_BYTES} bytes` })
        return
      }
      let body: unknown
      try {
        body = JSON.parse(read.body)
      } catch {
        sendJson(res, 400, { ok: false, code: 'bad-request', message: 'invalid JSON' })
        return
      }
      const obj = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>
      const text = obj.text
      if (typeof text !== 'string') {
        sendJson(res, 400, { ok: false, code: 'invalid-text', message: 'text must be a string' })
        return
      }
      if (text.trim().length === 0) {
        sendJson(res, 400, { ok: false, code: 'empty-text', message: 'text must not be empty' })
        return
      }
      if (Buffer.byteLength(text, 'utf8') > MAX_TEXT_BYTES) {
        sendJson(res, 400, { ok: false, code: 'text-too-large', message: `text exceeds ${MAX_TEXT_BYTES} utf8 bytes` })
        return
      }
      const imagesRaw = obj.images ?? []
      if (!Array.isArray(imagesRaw)) {
        sendJson(res, 400, { ok: false, code: 'invalid-images', message: 'images must be an array' })
        return
      }
      if (imagesRaw.length > MAX_IMAGES_PER_REQUEST) {
        sendJson(res, 400, { ok: false, code: 'too-many-images', message: `at most ${MAX_IMAGES_PER_REQUEST} images per request` })
        return
      }
      const images: ImagePayload[] = []
      for (const item of imagesRaw) {
        const candidate = (typeof item === 'object' && item !== null ? item : {}) as Record<string, unknown>
        if (
          typeof candidate.mediaType !== 'string' ||
          !ACCEPTED_IMAGE_MEDIA_TYPES.includes(candidate.mediaType) ||
          typeof candidate.data !== 'string'
        ) {
          sendJson(res, 400, { ok: false, code: 'invalid-image', message: 'each image must be {mediaType, data} with a supported mediaType' })
          return
        }
        if (Buffer.from(candidate.data, 'base64').byteLength > MAX_IMAGE_BYTES) {
          sendJson(res, 400, { ok: false, code: 'image-too-large', message: `each image must decode to at most ${MAX_IMAGE_BYTES} bytes` })
          return
        }
        images.push({ mediaType: candidate.mediaType, data: candidate.data })
      }
      try {
        const result = await optimize(text, images)
        sendJson(res, 200, { ok: true, text: result })
      } catch (err) {
        const code = err instanceof OptimizeError ? err.code : 'internal-error'
        const message = err instanceof OptimizeError ? err.message : 'optimization failed'
        ctx.logger.warn('[dsh-polish] optimize failed: %s', String(err))
        sendJson(res, 502, { ok: false, code, message })
      }
    } catch (err) {
      ctx.logger.error('[dsh-polish] request failed: %s', String(err))
      try {
        if (res.headersSent) res.end()
        else sendJson(res, 400, { ok: false, code: 'bad-request', message: 'request failed' })
      } catch {
        /* socket already gone */
      }
    }
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test 2>&1 | Select-String -Pattern "# pass|# fail" | Select-Object -Last 2`
Expected: `# fail 0`

- [ ] **Step 5: 提交**

```bash
git add src/handler.ts tests/unit/handler.unit.test.mjs lib/handler.js
git commit -m "feat(dsh-polish): accept composer images with limits in optimize route"
```

---

### Task 3: orchestrate.ts 图片解析编排

**Files:**
- Modify: `packages/dsh-polish/src/client/orchestrate.ts`
- Test: `packages/dsh-polish/tests/unit/orchestrate.unit.test.mjs`

**Interfaces:**
- Consumes: Task 1 的 `ImagePayload`（type-only import，构建时擦除，不引入客户端运行时依赖）
- Produces: `PolishGlue` 增加 `resolveImages?: () => Promise<ImagePayload[]>`、`post(text: string, images?: ImagePayload[])`；`runPolishClick` 先 resolveImages（失败 → notify 原消息且不 post），再 `post(draft, images)`

- [ ] **Step 1: 写失败测试**

`tests/unit/orchestrate.unit.test.mjs` 末尾新增 describe 块（既有 makeGlue 不动——其 post 只记 text，兼容新签名）：

```js
test.describe('runPolishClick 图片解析', () => {
  function makeGlueWithImages() {
    const calls = []
    return {
      calls,
      glue: {
        post: async (text, images) => { calls.push(['post', text, images]); return { ok: true, text: '优化后' } },
        setDraft: (text) => calls.push(['setDraft', text]),
        focusEnd: () => calls.push(['focusEnd']),
        notify: (text) => calls.push(['notify', text]),
        getCurrentDraft: () => '原文',
        resolveImages: async () => [{ mediaType: 'image/png', data: 'aGk=' }],
      },
    }
  }

  test('resolveImages 结果随 post 透传', async () => {
    const { calls, glue } = makeGlueWithImages()
    await runPolishClick('ready', '原文', glue)
    assert.deepEqual(calls[0], ['post', '原文', [{ mediaType: 'image/png', data: 'aGk=' }]])
    assert.deepEqual(calls.slice(1), [['setDraft', '优化后'], ['focusEnd']])
  })
  test('resolveImages 抛错 → notify 原消息，不 post 不动草稿', async () => {
    const { calls, glue } = makeGlueWithImages()
    glue.resolveImages = async () => { throw new Error('附件服务不可用') }
    await runPolishClick('ready', '原文', glue)
    assert.deepEqual(calls, [['notify', '附件服务不可用']])
  })
  test('无 resolveImages → post 收到空数组', async () => {
    const { calls, glue } = makeGlueWithImages()
    delete glue.resolveImages
    await runPolishClick('ready', '原文', glue)
    assert.deepEqual(calls[0], ['post', '原文', []])
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test 2>&1 | Select-String -Pattern "fail \d+" | Select-Object -Last 1`
Expected: 新增用例失败（旧 runPolishClick 不调用 resolveImages，`calls[0]` 无 images 字段 → deepEqual 失败）

- [ ] **Step 3: 实现**

`src/client/orchestrate.ts` 全量替换为：

```ts
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
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test 2>&1 | Select-String -Pattern "# pass|# fail" | Select-Object -Last 2`
Expected: `# fail 0`（既有 8 个 runPolishClick 用例不动也须全绿——旧 glue 的 post 忽略第二参）

- [ ] **Step 5: 提交**

```bash
git add src/client/orchestrate.ts tests/unit/orchestrate.unit.test.mjs lib/orchestrate.js
git commit -m "feat(dsh-polish): orchestrate image serialization for polish clicks"
```

---

### Task 4: index.tsx 接入 imageIds 与 conversation 服务

**Files:**
- Modify: `packages/dsh-polish/src/client/index.tsx`

**Interfaces:**
- Consumes: Task 3 的 `PolishGlue.resolveImages` / `post(text, images)`
- Produces: 无新导出（客户端 bundle 内部接线）

- [ ] **Step 1: 实现**

`src/client/index.tsx` 中：

1. `InputState` 接口与 `EntryProps` 增加字段：

```ts
interface InputState {
  draft?: string
  phase?: string
  imageIds?: string[]
}

/** conversation 服务序列化面（平台 dsh-client-ui-conversation 提供，root 单例）。 */
interface ConversationImages {
  serializeDraftImages(ids: string[]): Promise<Array<{ mediaType: string; data: string; name?: string }>>
}

interface EntryProps {
  useInput: (selector: (state: unknown) => unknown) => unknown
  useProjection: (key: string) => unknown
  inputActions: { setDraft: (text: string) => void }
  serializeImages?: (ids: string[]) => Promise<Array<{ mediaType: string; data: string; name?: string }>>
  [key: string]: unknown
}
```

2. `StarButton` 内，`phase` 读取之后加 imageIds 读取：

```ts
  const imageIds = ((props.useInput((s) => (s as InputState | undefined)?.imageIds ?? []) as string[] | undefined) ?? [])
```

3. `onClick` 的 glue 改为：

```ts
    void runPolishClick(action, draft, {
      post: (text, images) => postJson('/dsh-polish/optimize', { text, images }),
      resolveImages: async () => {
        if (imageIds.length === 0) return []
        if (props.serializeImages === undefined) throw new Error('附件服务不可用，无法识别图片')
        return props.serializeImages(imageIds)
      },
      setDraft: (text) => props.inputActions.setDraft(text),
      focusEnd,
      notify: (text) => setToast({ seq: Date.now(), text }),
      getCurrentDraft: () => draftRef.current,
    }).catch(() => setToast({ seq: Date.now(), text: '优化失败，请稍后重试' })).finally(() => setBusy(false))
```

4. `apply` 中 slot 注册包进 `ctx.inject(['conversation'], ...)`（conversation 服务晚挂载也不竞态；无该服务时 composer 本身不存在，slot 无宿主）：

```ts
export function apply(ctx: ClientCtx): void {
  ctx.inject(['conversation'], (cctx) => {
    const conversation = (cctx as ClientCtx & { conversation?: ConversationImages }).conversation
    const offSlot = ctx.slots.inject('conversation.input.left', () =>
      ctx.slots.register(
        { name: 'conversation.input.left', id: 'polish-composer', order: 31, label: TOOLTIP },
        (props: EntryProps) =>
          createElement(StarButton, {
            ...props,
            serializeImages: conversation === undefined ? undefined : (ids) => conversation.serializeDraftImages(ids),
          }),
      ),
    )
    ctx.effect(() => () => {
      offSlot()
    }, 'dsh-polish: client lifecycle (slot entry)')
  })

  // 设置卡片：settingsScope 服务缺失时 scoped fiber 不启动，星按钮主链路不受影响（保持不变）
  ctx.inject(['settingsScope'], (sctx) => {
    /* 原样保留 */
  })
}
```

- [ ] **Step 2: 类型检查 + 全量测试**

Run: `pnpm check 2>&1 | Select-Object -Last 5` → Expected: 无错误输出（退出码 0）
Run: `pnpm test 2>&1 | Select-String -Pattern "# pass|# fail" | Select-Object -Last 2` → Expected: `# fail 0`

- [ ] **Step 3: 提交**

```bash
git add src/client/index.tsx lib/client.js
git commit -m "feat(dsh-polish): wire composer imageIds and conversation service in client"
```

---

### Task 5: README 与全量回归

**Files:**
- Modify: `packages/dsh-polish/README.md`

- [ ] **Step 1: 更新 README**

第 8 行替换为：

```markdown
- host 半直连 `api.deepseek.com`（model `deepseek-v4-flash-vision-exp`，非流式）；密钥走 DSH credentials 服务，兜底 `DEEPSEEK_API_KEY` 环境变量
```

其后新增一行：

```markdown
- **支持图片识别**：composer 附件栏已上传的图片随优化请求一起发送；文本中的公网图片链接（png/jpg/jpeg/gif/webp）由模型侧自动下载识别
```

- [ ] **Step 2: 全量回归**

Run: `pnpm check` → Expected: 退出码 0
Run: `pnpm test 2>&1 | Select-String -Pattern "# tests|# pass|# fail" | Select-Object -Last 3` → Expected: `# pass` = 总数、`# fail 0`

- [ ] **Step 3: 提交**

```bash
git add README.md
git commit -m "docs(dsh-polish): vision model and image support in README"
```

- [ ] **Step 4: 手工验收清单（重启 DSH 后）**

1. composer 附件栏传 1-2 图 + 文本 → 点四角星 → 文本被覆盖、图片附件保留、光标在末尾
2. 文本带公网图片链接（png/jpg）→ 模型识别图内信息并优化文本
3. 纯文本 → 行为与之前一致（同一模型）
4. 回归：Read Only 置灰、空输入 Toast、草稿变化不覆盖、设置卡片自定义 systemPrompt 生效

---

## Self-Review 备注

- Spec 覆盖：模型切换（T1）、上传图（T1/T2/T3/T4）、链接直传（T1）、限额与错误路径（T2）、客户端串行化失败提示（T3）、覆盖只改文本（T3 既有 getCurrentDraft 逻辑不变）、回归清单（T5）
- 已知限制不实现：host 下载方案（spec 已否决）；无扩展名图片链接不提取（T1 测试锁定行为）
