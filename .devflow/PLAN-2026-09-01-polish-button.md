# dsh-polish 四角星优化按钮 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 DSH Desktop 底部工具栏书本图标（deepread，`conversation.input.left` order 30）右侧新增四角星按钮，点击后调用 DeepSeek API 优化细化输入框全文并整体覆盖，光标定位末尾。

**Architecture:** 新插件 `dsh-polish`（dsh-plugins monorepo `packages/dsh-polish`），host + client 双半。host 经 `ctx.webServer` 挂 `/dsh-polish/optimize` 路由（loopback trust fence），直调 `https://api.deepseek.com/chat/completions`（model `deepseek-v4-flash`，key 走 credentials 服务 → `DEEPSEEK_API_KEY` 环境变量兜底）。client 注册 `conversation.input.left` 槽位（id `polish-composer`，order 31），经 standard props `useProjection`/`useInput`/`inputActions` 读取只读状态与草稿、官方 `setDraft` 覆盖、`Toast`/`Tooltip` 用官方原语。

**Tech Stack:** TypeScript（tsdown 双目标构建，host=ESM node，client=CJS browser bundle 经 `window.__ModuleLoader__` 注册）、cordis 4（type-only）、React 18（client，平台 external）、pnpm 11、node --test。

**依据文档:** 设计 spec `DESIGN-2026-09-01-polish-button.md`（同目录）。模板代码来自 `packages/dsh-composer-tools`（同 monorepo，已验证）与 `C:\Users\spadmin\dsh-vision`。

## Global Constraints

- DSH Desktop 2.0.3；槽位 API 以官方 2.0.3 slot catalog 为准（`conversation.input.left` = list/session，register options `{name, id, order, label}`）
- 按钮槽位参数：`name: 'conversation.input.left'`、`id: 'polish-composer'`、`order: 31`、`label: '优化并细化当前用户输入'`
- 文案（逐字）：Tooltip「优化并细化当前用户输入」；空输入 Toast「请先输入内容再进行优化细化」
- 只读判定：`useProjection('permissions')` 的 `currentValue === 'read-only'`
- 草稿写入只走 `inputActions.setDraft()`（官方唯一公开路径）；禁止模拟 DOM input 事件
- 优化调用：非流式、`temperature 0.3`、`max_tokens = min(max(1024, ceil(len*2)+512), 8192)`、model `deepseek-v4-flash`
- host 侧**禁止** import 任何 `@deepseek-ai/*`（绕开双实例 junction 坑，credentials 经 `ctx.get('credentials')` 结构化调用）
- client 侧对 `@deepseek-ai/dsh-client-ui-primitives` 用 `declare module` shim（只类型），运行时走平台 external（purity gate 保证不打包）
- 不做设置面板、不做流式、不做 e2e；单测 node --test（无框架）

---

### Task 1: 脚手架 + trust-fence / http-util（拷贝模板 + 单测）

**Files:**
- Create: `packages/dsh-polish/package.json`
- Create: `packages/dsh-polish/cordis.patch.yml`
- Create: `packages/dsh-polish/tsconfig.json`
- Create: `packages/dsh-polish/tsconfig.client.json`
- Create: `packages/dsh-polish/build.mjs`
- Create: `packages/dsh-polish/tsdown.config.mjs`
- Create: `packages/dsh-polish/src/trust-fence.ts`
- Create: `packages/dsh-polish/src/http-util.ts`
- Test: `packages/dsh-polish/tests/unit/fence.unit.test.mjs`

**Interfaces:**
- Consumes: 无（首个任务）
- Produces: `lib/trust-fence.js` 导出 `isTrustedPolishRequest(req): boolean`；`lib/http-util.js` 导出 `isLoopbackHostname(hostname): boolean`、`parseAuthority(authority): {hostname,host}|undefined`。后续 handler（Task 3）消费 `isTrustedPolishRequest`。

- [ ] **Step 1: 写测试（先失败）**

`tests/unit/fence.unit.test.mjs`：

```js
// 白盒单测：trust-fence（lib/trust-fence.js 真实实现，模板自 composer-tools 官方 fence 移植）
import test from 'node:test'
import assert from 'node:assert/strict'
import { isTrustedPolishRequest } from '../../lib/trust-fence.js'

/** 造一个只带 headers 的 req（fence 只读 headers）。 */
function req(headers) {
  return { headers }
}

test.describe('trust-fence', () => {
  test('接受 localhost Host', () => {
    assert.equal(isTrustedPolishRequest(req({ host: 'localhost:3080' })), true)
  })
  test('接受 127.0.0.1 Host', () => {
    assert.equal(isTrustedPolishRequest(req({ host: '127.0.0.1:3080' })), true)
  })
  test('接受 [::1] Host', () => {
    assert.equal(isTrustedPolishRequest(req({ host: '[::1]:3080' })), true)
  })
  test('拒绝非 loopback Host', () => {
    assert.equal(isTrustedPolishRequest(req({ host: 'evil.example.com:3080' })), false)
  })
  test('拒绝 cross-site Sec-Fetch-Site', () => {
    assert.equal(
      isTrustedPolishRequest(req({ host: '127.0.0.1:3080', 'sec-fetch-site': 'cross-site' })),
      false,
    )
  })
  test('拒绝与 Host 不同源的 Origin', () => {
    assert.equal(
      isTrustedPolishRequest(req({ host: '127.0.0.1:3080', origin: 'https://evil.example.com' })),
      false,
    )
  })
  test('接受与 Host 同源的 Origin', () => {
    assert.equal(
      isTrustedPolishRequest(req({ host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080' })),
      true,
    )
  })
  test('拒绝缺失 Host', () => {
    assert.equal(isTrustedPolishRequest(req({})), false)
  })
  test('无 Origin 头时放行 loopback', () => {
    assert.equal(isTrustedPolishRequest(req({ host: '127.0.0.1:3080' })), true)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test tests/unit/fence.unit.test.mjs`
Expected: FAIL — `Cannot find module '../../lib/trust-fence.js'`

- [ ] **Step 3: 脚手架文件**

`package.json`：

```json
{
  "name": "dsh-polish",
  "version": "0.1.0",
  "description": "DSH 输入框四角星按钮：一键调用 DeepSeek 优化并细化当前输入，全文覆盖替换，光标定位末尾。",
  "license": "MIT",
  "type": "module",
  "main": "lib/index.js",
  "exports": {
    ".": "./lib/index.js",
    "./handler": "./lib/handler.js",
    "./optimize": "./lib/optimize.js",
    "./client": "./lib/client.js",
    "./package.json": "./package.json"
  },
  "files": [
    "lib",
    "cordis.patch.yml"
  ],
  "engines": {
    "node": ">=20"
  },
  "scripts": {
    "build": "node build.mjs",
    "check": "node node_modules/typescript/bin/tsc --noEmit && node node_modules/typescript/bin/tsc -p tsconfig.client.json --noEmit",
    "test": "node --test tests/unit/*.test.mjs"
  },
  "dsh": {
    "bundle": {
      "patch": "./cordis.patch.yml"
    },
    "client": {
      "platform": "web",
      "inject": [
        "@deepseek-ai/dsh-client-runtime",
        "@deepseek-ai/dsh-client-ui-slots",
        "@deepseek-ai/dsh-client-ui-primitives"
      ]
    }
  },
  "devDependencies": {
    "@types/node": "^26.2.0",
    "@types/react": "~18.3.1",
    "@types/react-dom": "~18.3.1",
    "cordis": "^4.0.0-rc.7",
    "lightningcss": "^1.32.0",
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "tsdown": "^0.22.2",
    "typescript": "^5.6.0"
  },
  "peerDependencies": {
    "@deepseek-ai/cordis": "*",
    "react": "^18.0.0",
    "react-dom": "^18.0.0"
  }
}
```

`cordis.patch.yml`：

```yaml
# dsh-polish bundle patch：声明插件行（node 半入口 = package main lib/index.js）。
- insert:
    - id: polish
      name: 'dsh-polish'
```

`tsconfig.json`（host 侧）：

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts"],
  "exclude": ["src/client"]
}
```

`tsconfig.client.json`：

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "jsxImportSource": "react",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "types": ["node"]
  },
  "include": ["src/client/**/*.ts", "src/client/**/*.tsx"]
}
```

`build.mjs`（与 composer-tools 相同，Windows 下免 shell shim 直跑 tsdown）：

```js
// 构建驱动：rm lib 后用当前 node 直接执行 tsdown 入口（无 shell、跨平台）。
import { rm } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = fileURLToPath(new URL('.', import.meta.url))
process.chdir(HERE)

await rm('lib', { recursive: true, force: true })
const require = createRequire(import.meta.url)
const pkgJson = require.resolve('tsdown/package.json')
const tsdownEntry = join(dirname(pkgJson), 'dist', 'run.mjs')
execFileSync(process.execPath, [tsdownEntry], { stdio: 'inherit' })
```

`tsdown.config.mjs`（本任务只含 trust-fence/http-util 两个 node 入口；后续任务逐步加 entry；client 配置 Task 5 加）：

```js
// dsh-polish dual-half build（模板自 composer-tools tsdown.config.mjs）。
import { readFile } from 'node:fs/promises'
import { basename, dirname, relative, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'
import { builtinModules } from 'node:module'
import { transform } from 'lightningcss'

const REPOSITORY_ROOT = fileURLToPath(new URL('.', import.meta.url))

const NODE_BUILTINS = new Set([
  ...builtinModules,
  ...builtinModules.map((id) => `node:${id}`),
])

const CLIENT_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  'cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-web-react',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-schema-form',
  '@deepseek-ai/dsh-client-runtime/client',
]

const INLINE_SAFE = /^@deepseek-ai\/dsh-(host-apiproxy|session|llm|tools|brand)(\/|$)/

const CSS_VIRTUAL_PREFIX = '\0dsh-css:'
const CSS_VIRTUAL_SUFFIX = '.mjs'

const PLUGIN_ID = 'dsh-polish'

function injectTag(pluginId, fileId, cssText) {
  const tagId = `${pluginId}/${basename(fileId)}`
  return [
    `const css = ${JSON.stringify(cssText)};`,
    `const tagId = ${JSON.stringify(tagId)};`,
    `if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']') === null) {`,
    `  const tag = document.createElement('style');`,
    `  tag.dataset.plugin = ${JSON.stringify(pluginId)};`,
    `  tag.dataset.pluginCss = tagId;`,
    `  tag.textContent = css;`,
    `  document.head.appendChild(tag);`,
    `}`,
  ].join('\n')
}

function purityGatePlugin() {
  return {
    name: 'dsh-client-bundle-purity',
    resolveId(source) {
      if (NODE_BUILTINS.has(source)) {
        throw new Error(
          `client bundle purity: Node builtin "${source}" cannot run in the browser module table — `
          + 'select the dependency browser export or add an explicit browser implementation',
        )
      }
      if (!source.startsWith('@deepseek-ai/')) return null
      if (CLIENT_EXTERNALS.includes(source)) return null
      if (INLINE_SAFE.test(source)) return null
      throw new Error(
        `client bundle purity: "${source}" is not a platform module (CLIENT_EXTERNALS) and not an inline-safe wire layer — `
        + 'cross-plugin value imports are forbidden; collaborate through cordis services (type-only imports are erased and never reach this gate)',
      )
    },
  }
}

function makeCssPlugin(pluginId) {
  return {
    name: 'dsh-css-inline',
    resolveId(source, importer) {
      if (!source.endsWith('.css')) return null
      let abs
      if (source.startsWith('.') || source.startsWith('/') || /^[A-Za-z]:[\\/]/.test(source)) {
        abs = importer === undefined ? source : resolvePath(dirname(importer), source)
      } else {
        abs = require.resolve(source)
      }
      const rel = relative(REPOSITORY_ROOT, abs)
      return CSS_VIRTUAL_PREFIX + rel + CSS_VIRTUAL_SUFFIX
    },
    async load(virtualId) {
      if (!virtualId.startsWith(CSS_VIRTUAL_PREFIX)) return null
      const relId = virtualId.slice(CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
      const fileId = resolvePath(REPOSITORY_ROOT, relId)
      this.addWatchFile(fileId)
      const source = await readFile(fileId)
      if (fileId.endsWith('.module.css')) {
        const { code, exports: cssExports } = transform({
          filename: fileId,
          code: source,
          cssModules: { pattern: '[hash]_[local]' },
          minify: true,
        })
        const classMap = {}
        for (const [local, exp] of Object.entries(cssExports ?? {})) classMap[local] = exp.name
        return [
          injectTag(pluginId, fileId, code.toString()),
          `export default ${JSON.stringify(classMap)};`,
        ].join('\n')
      }
      return [
        injectTag(pluginId, fileId, source.toString('utf8')),
        'export default "";',
      ].join('\n')
    },
  }
}

export default [
  {
    entry: {
      'trust-fence': 'src/trust-fence.ts',
      'http-util': 'src/http-util.ts',
    },
    outDir: 'lib',
    format: 'esm',
    platform: 'node',
    target: 'es2022',
    fixedExtension: false,
    dts: false,
    sourcemap: false,
    clean: false,
  },
  // client browser bundle 在 Task 5 追加
]
```

- [ ] **Step 4: 实现 trust-fence.ts / http-util.ts（自 composer-tools 逐字拷贝，仅改名）**

`src/trust-fence.ts`：

```ts
/**
 * Loopback trust fence for every /dsh-polish/* request.
 * Faithful port of the official isTrustedApiRequest predicate
 * (dsh-client-connection/lib/index.js), same guarantees:
 *   - Host header must name a loopback authority (localhost / 127/8 / [::1])
 *   - a cross-site Sec-Fetch-Site header is refused
 *   - a present Origin must be same-origin with the Host
 * Anything else is 403, before any handler work runs.
 */
import type { IncomingMessage } from 'node:http'
import { isLoopbackHostname, parseAuthority } from './http-util.js'

export function isTrustedPolishRequest(req: IncomingMessage): boolean {
  const host = req.headers['host']
  if (typeof host !== 'string' || host.length === 0) return false
  const hostUrl = parseAuthority(host)
  if (hostUrl === undefined) return false
  if (!isLoopbackHostname(hostUrl.hostname)) return false

  const secFetchSite = req.headers['sec-fetch-site']
  if (typeof secFetchSite === 'string' && secFetchSite.toLowerCase() === 'cross-site') return false

  const origin = req.headers['origin']
  if (origin === undefined || origin === null) return true
  try {
    return new URL(String(origin)).host === hostUrl.host
  } catch {
    return false
  }
}
```

`src/http-util.ts`：

```ts
/** Host/authority parsing helpers for the trust fence (official /api fence 同源移植)。 */

export function isLoopbackHostname(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '[::1]') return true
  const parts = hostname.split('.')
  return (
    parts.length === 4 &&
    parts[0] === '127' &&
    parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
  )
}

export function parseAuthority(authority: string): { hostname: string; host: string } | undefined {
  try {
    const url = new URL(`http://${authority}`)
    return { hostname: url.hostname, host: url.host }
  } catch {
    return undefined
  }
}
```

- [ ] **Step 5: 安装依赖并构建**

Run:
```
cd D:\xgzhang\projects\dsh-plugins\packages\dsh-polish
pnpm install
pnpm build
```
Expected: `lib/trust-fence.js` 与 `lib/http-util.js` 生成，无报错。

- [ ] **Step 6: 跑测试确认通过**

Run: `pnpm test`
Expected: PASS — 9/9（fence.unit.test.mjs）

- [ ] **Step 7: Commit**

```bash
cd D:\xgzhang\projects\dsh-plugins
git add packages/dsh-polish
git commit -m "feat(dsh-polish): 脚手架 + loopback trust fence（拷贝 composer-tools 模板，9 单测）"
```

---

### Task 2: optimize.ts — prompt 构造 + DeepSeek 直连（纯函数 + 注入 fetch）

**Files:**
- Create: `packages/dsh-polish/src/optimize.ts`
- Test: `packages/dsh-polish/tests/unit/optimize.unit.test.mjs`
- Modify: `packages/dsh-polish/tsdown.config.mjs`（node entry 加 `optimize: 'src/optimize.ts'`）

**Interfaces:**
- Consumes: 无
- Produces: `lib/optimize.js` 导出 `OptimizeError`（`code: 'missing-credential'|'transport'|'api-error'|'empty-response'`）、`MODEL`、`BASE_URL`、`buildOptimizePrompt(text)`、`callDeepSeekOptimize(text, deps?)`。Task 3 的 handler 消费两者。

- [ ] **Step 1: 写测试（先失败）**

`tests/unit/optimize.unit.test.mjs`：

```js
// 白盒单测：optimize（lib/optimize.js 真实实现）
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildOptimizePrompt, callDeepSeekOptimize, OptimizeError, MODEL, BASE_URL } from '../../lib/optimize.js'

/** 造 fetch 替身：返回给定 status + json。 */
function fakeFetch(status, json) {
  return async (url, init) => {
    calls.push({ url, init })
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => json,
    }
  }
}
let calls = []

test.beforeEach(() => {
  calls = []
})

test.describe('buildOptimizePrompt', () => {
  test('model/temperature/stream 固定', () => {
    const p = buildOptimizePrompt('你好')
    assert.equal(p.model, MODEL)
    assert.equal(p.temperature, 0.3)
    assert.equal(p.stream, false)
  })
  test('max_tokens 下限 1024', () => {
    assert.equal(buildOptimizePrompt('短').max_tokens, 1024)
  })
  test('max_tokens = 2×len+512，上限 8192', () => {
    assert.equal(buildOptimizePrompt('x'.repeat(1000)).max_tokens, 1000 * 2 + 512)
    assert.equal(buildOptimizePrompt('x'.repeat(100000)).max_tokens, 8192)
  })
  test('system 含四条优化规则与只输出正文约束', () => {
    const p = buildOptimizePrompt('你好')
    const s = p.messages[0].content
    for (const kw of ['核心想法', '语病', '冗余', '细节', '语气风格', '只输出优化后的完整文本']) {
      assert.ok(s.includes(kw), `system 应包含「${kw}」`)
    }
    assert.deepEqual(p.messages[1], { role: 'user', content: '你好' })
  })
})

test.describe('callDeepSeekOptimize', () => {
  test('成功：返回 choices[0].message.content', async () => {
    const out = await callDeepSeekOptimize('原文', {
      fetchImpl: fakeFetch(200, { choices: [{ message: { content: '优化后' } }] }),
      resolveApiKey: async () => 'sk-test',
    })
    assert.equal(out, '优化后')
    assert.equal(calls[0].url, `${BASE_URL}/chat/completions`)
    assert.equal(calls[0].init.headers.authorization, 'Bearer sk-test')
  })
  test('缺密钥：resolveApiKey 抛错 → missing-credential', async () => {
    await assert.rejects(
      callDeepSeekOptimize('x', { fetchImpl: fakeFetch(200, {}), resolveApiKey: async () => { throw new Error('no key') } }),
      (err) => err instanceof OptimizeError && err.code === 'missing-credential',
    )
    assert.equal(calls.length, 0)
  })
  test('HTTP 错误：透出 API error message', async () => {
    await assert.rejects(
      callDeepSeekOptimize('x', {
        fetchImpl: fakeFetch(429, { error: { message: 'rate limited' } }),
        resolveApiKey: async () => 'sk-test',
      }),
      (err) => err instanceof OptimizeError && err.code === 'api-error' && err.message === 'rate limited',
    )
  })
  test('网络失败 → transport', async () => {
    await assert.rejects(
      callDeepSeekOptimize('x', {
        fetchImpl: async () => { throw new Error('ECONNREFUSED') },
        resolveApiKey: async () => 'sk-test',
      }),
      (err) => err instanceof OptimizeError && err.code === 'transport',
    )
  })
  test('content 为空 → empty-response', async () => {
    await assert.rejects(
      callDeepSeekOptimize('x', {
        fetchImpl: fakeFetch(200, { choices: [{ message: { content: '   ' } }] }),
        resolveApiKey: async () => 'sk-test',
      }),
      (err) => err instanceof OptimizeError && err.code === 'empty-response',
    )
  })
  test('非 JSON 响应 → api-error', async () => {
    await assert.rejects(
      callDeepSeekOptimize('x', {
        fetchImpl: async () => ({ ok: true, status: 200, json: async () => { throw new Error('bad json') } }),
        resolveApiKey: async () => 'sk-test',
      }),
      (err) => err instanceof OptimizeError && err.code === 'api-error',
    )
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test tests/unit/optimize.unit.test.mjs`
Expected: FAIL — `Cannot find module '../../lib/optimize.js'`

- [ ] **Step 3: 实现 optimize.ts**

`src/optimize.ts`：

```ts
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

const SYSTEM_PROMPT = [
  '你是文本优化助手。请对用户提供的文本进行优化与细化：',
  '1. 保留用户原本的核心想法与意图，不得篡改原意；',
  '2. 理顺语句逻辑，修正语病，删除冗余废话；',
  '3. 补充缺失细节，扩充描述层次，使表达更完整、严谨、条理清晰；',
  '4. 维持原有语气风格，不强行改变文体。',
  '只输出优化后的完整文本，不要输出任何解释、标题或前后缀。',
].join('\n')

export function buildOptimizePrompt(text: string) {
  return {
    model: MODEL,
    temperature: 0.3,
    stream: false,
    max_tokens: Math.min(Math.max(1024, Math.ceil(text.length * 2) + 512), MAX_OUTPUT_TOKENS),
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: text },
    ],
  }
}

export interface OptimizeDeps {
  fetchImpl?: typeof fetch
  resolveApiKey?: () => Promise<string>
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
      body: JSON.stringify(buildOptimizePrompt(text)),
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

- [ ] **Step 4: tsdown.config.mjs 加 entry**

把 node 配置的 `entry` 改为：

```js
    entry: {
      'trust-fence': 'src/trust-fence.ts',
      'http-util': 'src/http-util.ts',
      optimize: 'src/optimize.ts',
    },
```

- [ ] **Step 5: 构建 + 测试通过**

Run:
```
pnpm build
pnpm test
```
Expected: PASS — fence 9 + optimize 10 全绿。

- [ ] **Step 6: Commit**

```bash
cd D:\xgzhang\projects\dsh-plugins
git add packages/dsh-polish
git commit -m "feat(dsh-polish): DeepSeek 优化直连层（prompt 构造 + 错误分类，10 单测）"
```

---

### Task 3: handler.ts + index.ts — host 路由与插件入口

**Files:**
- Create: `packages/dsh-polish/src/handler.ts`
- Create: `packages/dsh-polish/src/index.ts`
- Test: `packages/dsh-polish/tests/unit/handler.unit.test.mjs`
- Modify: `packages/dsh-polish/tsdown.config.mjs`（node entry 加 `handler` 与 `index`）

**Interfaces:**
- Consumes: Task 1 `isTrustedPolishRequest`；Task 2 `callDeepSeekOptimize`/`OptimizeError`
- Produces: `lib/handler.js` 导出 `createPolishHandler(ctx, opts?): PolishHandler`、`readRequestBody`、`MAX_BODY_BYTES`、`MAX_TEXT_BYTES`。`lib/index.js` 导出 `name='dsh-polish'`、`inject=['webServer']`、`apply(ctx)`（宿主入口，package main）。Task 6 安装消费 index。

- [ ] **Step 1: 写测试（先失败）**

`tests/unit/handler.unit.test.mjs`：

```js
// 白盒单测：handler（lib/handler.js 真实实现，真实 HTTP 全链路 + 假 optimize）
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { createPolishHandler } from '../../lib/handler.js'

const LOGGER = { warn: () => {}, error: () => {} }

function makeCtx() {
  return { logger: LOGGER }
}

/** 起真实 HTTP 服务，返回 baseUrl 与关闭函数。 */
async function serve(optimize) {
  const handler = createPolishHandler(makeCtx(), { optimize })
  const server = http.createServer((req, res) => { void handler(req, res) })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}

async function post(baseUrl, body, extraHeaders = {}) {
  return fetch(`${baseUrl}/dsh-polish/optimize`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...extraHeaders },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

test.describe('handler（真实 HTTP）', () => {
  test('200：假 optimize 结果透传', async () => {
    const { baseUrl, close } = await serve(async (text) => `OPT:${text}`)
    const res = await post(baseUrl, { text: '原文' })
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), { ok: true, text: 'OPT:原文' })
    await close()
  })
  test('403：非 loopback Host（raw request 伪造 Host 头）', async () => {
    const { baseUrl, close } = await serve(async (t) => t)
    const { port } = new URL(baseUrl)
    const res = await new Promise((resolve, reject) => {
      const req = http.request(
        { host: '127.0.0.1', port, path: '/dsh-polish/optimize', method: 'POST', headers: { host: 'evil.example.com', 'content-type': 'application/json' } },
        (r) => { let b = ''; r.on('data', (c) => (b += c)); r.on('end', () => resolve({ status: r.statusCode, body: b })) },
      )
      req.on('error', reject)
      req.end(JSON.stringify({ text: 'x' }))
    })
    assert.equal(res.status, 403)
    assert.equal(res.body, 'forbidden')
    await close()
  })
  test('405：GET 拒绝', async () => {
    const { baseUrl, close } = await serve(async (t) => t)
    const res = await fetch(`${baseUrl}/dsh-polish/optimize`)
    assert.equal(res.status, 405)
    await close()
  })
  test('400：非法 JSON', async () => {
    const { baseUrl, close } = await serve(async (t) => t)
    const res = await post(baseUrl, '{not json')
    assert.equal(res.status, 400)
    assert.deepEqual(await res.json(), { ok: false, code: 'bad-request', message: 'invalid JSON' })
    await close()
  })
  test('400：text 非字符串', async () => {
    const { baseUrl, close } = await serve(async (t) => t)
    const res = await post(baseUrl, { text: 42 })
    assert.equal(res.status, 400)
    assert.deepEqual((await res.json()).code, 'invalid-text')
    await close()
  })
  test('400：text 空白', async () => {
    const { baseUrl, close } = await serve(async (t) => t)
    const res = await post(baseUrl, { text: '   ' })
    assert.equal(res.status, 400)
    assert.deepEqual((await res.json()).code, 'empty-text')
    await close()
  })
  test('502：optimize 抛 OptimizeError → code/message 透传', async () => {
    const { OptimizeError } = await import('../../lib/optimize.js')
    const { baseUrl, close } = await serve(async () => { throw new OptimizeError('missing-credential', 'no key') })
    const res = await post(baseUrl, { text: 'x' })
    assert.equal(res.status, 502)
    assert.deepEqual(await res.json(), { ok: false, code: 'missing-credential', message: 'no key' })
    await close()
  })
  test('502：optimize 抛未知错误 → internal-error', async () => {
    const { baseUrl, close } = await serve(async () => { throw new Error('boom') })
    const res = await post(baseUrl, { text: 'x' })
    assert.equal(res.status, 502)
    assert.deepEqual((await res.json()).code, 'internal-error')
    await close()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test tests/unit/handler.unit.test.mjs`
Expected: FAIL — `Cannot find module '../../lib/handler.js'`

- [ ] **Step 3: 实现 handler.ts**

`src/handler.ts`：

```ts
/**
 * /dsh-polish/* RPC 面。判定顺序 = 传输契约：
 *   1 trust fence → 403 plain 'forbidden'
 *   2 非 POST → 405（allow: POST）
 *   3 路径非 /dsh-polish/optimize → 404
 *   4 body > 2MB → 413；读取失败 → 400；非法 JSON → 400
 *   5 text 非字符串 → 400 invalid-text；空白 → 400 empty-text；> 200KB → 400 text-too-large
 *   6 optimize 抛 OptimizeError → 502 透传 code/message；未知错误 → 502 internal-error
 * 异步 handler 永不 reject；ctx.logger 现取现用。
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from 'cordis'
import { isTrustedPolishRequest } from './trust-fence.js'
import { callDeepSeekOptimize, OptimizeError } from './optimize.js'

export const MAX_BODY_BYTES = 2 * 1024 * 1024
export const MAX_TEXT_BYTES = 200 * 1024

export type OptimizeFn = (text: string) => Promise<string>

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
  const optimize = opts.optimize ?? callDeepSeekOptimize
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
      try {
        const result = await optimize(text)
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

- [ ] **Step 4: 实现 index.ts（host 入口）**

`src/index.ts`：

```ts
/**
 * dsh-polish — node (host) half, a Cordis plugin.
 * 把 /dsh-polish/* RPC 面挂上 webServer（inject 声明 → bare 可访问），
 * API key：credentials 服务（结构化调用，无 @deepseek-ai import）→ process.env 兜底。
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from 'cordis'
import { createPolishHandler } from './handler.js'
import { callDeepSeekOptimize, OptimizeError } from './optimize.js'

const API_KEY_REF = 'DEEPSEEK_API_KEY'

export const name = 'dsh-polish'

export const inject: readonly string[] = ['webServer']

interface WebServerService {
  register(route: {
    kind: string
    path: string
    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
  }): () => void
}

interface CredentialsService {
  resolve(ref: string): Promise<{ value: string } | undefined>
}

type InjectedCtx = Context & { webServer?: WebServerService }

async function resolveApiKey(ctx: Context): Promise<string> {
  const credentials = ctx.get('credentials') as CredentialsService | undefined
  if (credentials !== undefined) {
    const hit = await credentials.resolve(API_KEY_REF)
    if (hit !== undefined && hit.value.length > 0) return hit.value
  }
  const ambient = process.env[API_KEY_REF]
  if (ambient !== undefined && ambient.length > 0) return ambient
  throw new OptimizeError(
    'missing-credential',
    `dsh-polish: no API key "${API_KEY_REF}" — store it through the credentials service or set the ${API_KEY_REF} environment variable`,
  )
}

export function apply(ctx: InjectedCtx): void {
  const handler = createPolishHandler(ctx, {
    optimize: (text) => callDeepSeekOptimize(text, { resolveApiKey: () => resolveApiKey(ctx) }),
  })

  const webServer = ctx.webServer
  if (!webServer || typeof webServer.register !== 'function') {
    ctx.logger.warn('[dsh-polish] webServer service unavailable; /dsh-polish routes are not mounted')
    return
  }

  let dispose: () => void
  try {
    dispose = webServer.register({ kind: 'prefix', path: '/dsh-polish', handler })
  } catch (err) {
    ctx.logger.warn('[dsh-polish] failed to mount /dsh-polish routes: %s', String(err))
    return
  }
  ctx.effect(() => dispose)
}
```

- [ ] **Step 5: tsdown.config.mjs 加 entry**

把 node 配置的 `entry` 改为：

```js
    entry: {
      'trust-fence': 'src/trust-fence.ts',
      'http-util': 'src/http-util.ts',
      optimize: 'src/optimize.ts',
      handler: 'src/handler.ts',
      index: 'src/index.ts',
    },
```

- [ ] **Step 6: 构建 + 全部测试通过**

Run:
```
pnpm build
pnpm test
node node_modules/typescript/bin/tsc --noEmit
```
Expected: PASS — fence 9 + optimize 10 + handler 8 全绿；tsc host 侧无错。

注意：本任务只跑 host tsc。全量 `pnpm check`（含 client tsconfig）留到 Task 5 首次执行——client tsconfig 的 include 是 `src/client/**`，该目录 Task 5 才创建，此前跑 client tsc 必然 TS18003（空 include 预期行为，勿"修复"）。

- [ ] **Step 7: Commit**

```bash
cd D:\xgzhang\projects\dsh-plugins
git add packages/dsh-polish
git commit -m "feat(dsh-polish): host 路由与入口（webServer + fence + 传输契约，8 单测）"
```

---

### Task 4: client 纯逻辑 — state.ts + orchestrate.ts

**Files:**
- Create: `packages/dsh-polish/src/client/state.ts`
- Create: `packages/dsh-polish/src/client/orchestrate.ts`
- Test: `packages/dsh-polish/tests/unit/state.unit.test.mjs`
- Test: `packages/dsh-polish/tests/unit/orchestrate.unit.test.mjs`
- Modify: `packages/dsh-polish/tsdown.config.mjs`（node entry 加 `state` 与 `orchestrate`；两文件在 client 目录但构建为 node ESM 供 node --test 驱动，composer-tools 同款模式）

**Interfaces:**
- Consumes: 无
- Produces: `lib/state.js` 导出 `decidePolishAction(permission, phase, draft): 'disabled'|'empty'|'ready'`；`lib/orchestrate.js` 导出 `postJson(path, body, fetchImpl?)`、`runPolishClick(action, draft, glue)`、`EMPTY_HINT`、`PolishGlue`/`PolishResult` 类型。Task 5 的 UI 组件消费两者。

- [ ] **Step 1: 写测试（先失败）**

`tests/unit/state.unit.test.mjs`：

```js
// 白盒单测：state（lib/state.js 真实实现）
import test from 'node:test'
import assert from 'node:assert/strict'
import { decidePolishAction } from '../../lib/state.js'

test.describe('decidePolishAction', () => {
  test('read-only 权限 → disabled', () => {
    assert.equal(decidePolishAction('read-only', 'plain', '有内容'), 'disabled')
  })
  test('submitting 阶段 → disabled（防发送中替换草稿）', () => {
    assert.equal(decidePolishAction('danger-full-access', 'submitting', '有内容'), 'disabled')
  })
  test('adjudicating 阶段 → disabled', () => {
    assert.equal(decidePolishAction('workspace-write', 'adjudicating', '有内容'), 'disabled')
  })
  test('权限未定义（容错）→ 不因缺失而 disabled', () => {
    assert.equal(decidePolishAction(undefined, 'plain', '有内容'), 'ready')
  })
  test('空草稿 → empty（空白也算空）', () => {
    assert.equal(decidePolishAction('danger-full-access', 'plain', ''), 'empty')
    assert.equal(decidePolishAction('danger-full-access', 'plain', '   \n '), 'empty')
  })
  test('正常 → ready', () => {
    assert.equal(decidePolishAction('danger-full-access', 'plain', ' 你好 '), 'ready')
  })
})
```

`tests/unit/orchestrate.unit.test.mjs`：

```js
// 白盒单测：orchestrate（lib/orchestrate.js 真实实现，注入替身）
import test from 'node:test'
import assert from 'node:assert/strict'
import { postJson, runPolishClick, EMPTY_HINT } from '../../lib/orchestrate.js'

/** 记录型 glue：捕获调用序列。 */
function makeGlue(postResult) {
  const calls = []
  return {
    calls,
    glue: {
      post: async (text) => { calls.push(['post', text]); return postResult },
      setDraft: (text) => calls.push(['setDraft', text]),
      focusEnd: () => calls.push(['focusEnd']),
      notify: (text) => calls.push(['notify', text]),
    },
  }
}

test.describe('runPolishClick', () => {
  test('empty → 只提示空输入文案，不 post', async () => {
    const { calls, glue } = makeGlue({ ok: true, text: 'x' })
    await runPolishClick('empty', '   ', glue)
    assert.deepEqual(calls, [['notify', EMPTY_HINT]])
  })
  test('disabled → 完全无动作', async () => {
    const { calls, glue } = makeGlue({ ok: true, text: 'x' })
    await runPolishClick('disabled', '原文', glue)
    assert.deepEqual(calls, [])
  })
  test('ready 成功 → setDraft(优化文本) + focusEnd', async () => {
    const { calls, glue } = makeGlue({ ok: true, text: '优化后' })
    await runPolishClick('ready', '原文', glue)
    assert.deepEqual(calls, [
      ['post', '原文'],
      ['setDraft', '优化后'],
      ['focusEnd'],
    ])
  })
  test('ready 失败 → notify 错误信息，不动 draft', async () => {
    const { calls, glue } = makeGlue({ ok: false, code: 'api-error', message: 'API 挂了' })
    await runPolishClick('ready', '原文', glue)
    assert.deepEqual(calls, [
      ['post', '原文'],
      ['notify', 'API 挂了'],
    ])
  })
  test('ready 失败且无 message → 兜底文案', async () => {
    const { calls, glue } = makeGlue({ ok: false })
    await runPolishClick('ready', '原文', glue)
    assert.deepEqual(calls[1], ['notify', '优化失败，请稍后重试'])
  })
})

test.describe('postJson', () => {
  const ok = (json) => async () => ({ ok: true, status: 200, json: async () => json })

  test('200 透传 JSON', async () => {
    const r = await postJson('/x', { a: 1 }, ok({ ok: true, text: 'y' }))
    assert.deepEqual(r, { ok: true, text: 'y' })
  })
  test('网络错误 → ok:false + message', async () => {
    const r = await postJson('/x', {}, async () => { throw new Error('ECONNREFUSED') })
    assert.equal(r.ok, false)
    assert.match(r.message, /ECONNREFUSED/)
  })
  test('HTTP 错误 → ok:false + 中文状态提示', async () => {
    const r = await postJson('/x', {}, async () => ({ ok: false, status: 502, json: async () => ({}) }))
    assert.equal(r.ok, false)
    assert.match(r.message, /502/)
  })
  test('非 JSON 体 → ok:false + 提示', async () => {
    const r = await postJson('/x', {}, async () => ({ ok: true, status: 200, json: async () => { throw new Error('bad') } }))
    assert.equal(r.ok, false)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test tests/unit/state.unit.test.mjs tests/unit/orchestrate.unit.test.mjs`
Expected: FAIL — `Cannot find module '../../lib/state.js'`

- [ ] **Step 3: 实现 state.ts / orchestrate.ts**

`src/client/state.ts`：

```ts
/** 按钮三态判定（纯函数，供组件与单测共用）。 */

export type PolishAction = 'disabled' | 'empty' | 'ready'

export function decidePolishAction(permission: string | undefined, phase: string, draft: string): PolishAction {
  if (permission === 'read-only' || phase === 'submitting' || phase === 'adjudicating') return 'disabled'
  if (draft.trim() === '') return 'empty'
  return 'ready'
}
```

`src/client/orchestrate.ts`：

```ts
/**
 * 点击编排（纯、可注入）：empty → 提示；ready → post → 成功 setDraft+focusEnd，失败 notify。
 * postJson 归一所有运输失败为结构化 PolishResult，永不 reject（composer-tools bridgeCore 同款）。
 */
import type { PolishAction } from './state.js'

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
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<HttpLike>

export async function postJson(path: string, body: unknown, fetchImpl: FetchLike = fetch as unknown as FetchLike): Promise<PolishResult> {
  let res: HttpLike
  try {
    res = await fetchImpl(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    })
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) }
  }
  if (!res.ok) {
    return { ok: false, message: `请求失败（HTTP ${res.status}）` }
  }
  let json: unknown
  try {
    json = await res.json()
  } catch {
    return { ok: false, message: '宿主返回了非 JSON 响应' }
  }
  return json as PolishResult
}

export interface PolishGlue {
  post(text: string): Promise<PolishResult>
  setDraft(text: string): void
  focusEnd(): void
  notify(text: string): void
}

export const EMPTY_HINT = '请先输入内容再进行优化细化'

export async function runPolishClick(action: PolishAction, draft: string, glue: PolishGlue): Promise<void> {
  if (action === 'empty') {
    glue.notify(EMPTY_HINT)
    return
  }
  if (action !== 'ready') return
  const result = await glue.post(draft)
  if (result.ok && typeof result.text === 'string' && result.text.length > 0) {
    glue.setDraft(result.text)
    glue.focusEnd()
  } else {
    glue.notify(result.message ?? '优化失败，请稍后重试')
  }
}
```

- [ ] **Step 4: tsdown.config.mjs 加 entry**

把 node 配置的 `entry` 改为：

```js
    entry: {
      'trust-fence': 'src/trust-fence.ts',
      'http-util': 'src/http-util.ts',
      optimize: 'src/optimize.ts',
      handler: 'src/handler.ts',
      index: 'src/index.ts',
      state: 'src/client/state.ts',
      orchestrate: 'src/client/orchestrate.ts',
    },
```

- [ ] **Step 5: 构建 + 全部测试通过**

Run:
```
pnpm build
pnpm test
```
Expected: PASS — fence 9 + optimize 10 + handler 8 + state 6 + orchestrate 9 全绿。

- [ ] **Step 6: Commit**

```bash
cd D:\xgzhang\projects\dsh-plugins
git add packages/dsh-polish
git commit -m "feat(dsh-polish): client 三态判定与点击编排纯逻辑（15 单测）"
```

---

### Task 5: client UI — 四角星按钮组件 + 槽位注册 + client 构建

**Files:**
- Create: `packages/dsh-polish/src/client/platform.d.ts`
- Create: `packages/dsh-polish/src/client/icon.tsx`
- Create: `packages/dsh-polish/src/client/star.css`
- Create: `packages/dsh-polish/src/client/index.tsx`
- Modify: `packages/dsh-polish/tsdown.config.mjs`（追加 client browser bundle 配置）

**Interfaces:**
- Consumes: Task 4 `decidePolishAction`/`postJson`/`runPolishClick`；平台 external `@deepseek-ai/dsh-client-ui-primitives`（Toast/Tooltip）
- Produces: `lib/client.js`（browser CJS bundle，经 `window.__ModuleLoader__.load({id:'dsh-polish', factory})` 注册，client 入口 export `apply(ctx)`、`inject=['slots']`）。Task 6 安装消费。

- [ ] **Step 1: 平台类型 shim 与图标、样式**

`src/client/platform.d.ts`：

```ts
declare module '*.css'

declare module '@deepseek-ai/dsh-client-ui-primitives' {
  import type { ReactNode } from 'react'
  export const Toast: (props: { text: string; icon?: ReactNode; anchor?: Element | null; onDone: () => void }) => ReactNode
  export const Tooltip: (props: { label: string; side?: 'top' | 'bottom' | 'left' | 'right'; delayMs?: number; children: ReactNode }) => ReactNode
}
```

`src/client/icon.tsx`：

```tsx
/** 四角星图标：细线空心 + 四角顶点小圆点（浅灰 currentColor，无填充）。 */
import { createElement } from 'react'

export function StarIcon() {
  return createElement(
    'svg',
    { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
    createElement('path', {
      d: 'M8 1.8 L9.4 6.6 L14.2 8 L9.4 9.4 L8 14.2 L6.6 9.4 L1.8 8 L6.6 6.6 Z',
      stroke: 'currentColor',
      strokeWidth: 1.2,
      strokeLinejoin: 'round',
      fill: 'none',
    }),
    createElement('circle', { cx: 8, cy: 1.8, r: 1, fill: 'currentColor' }),
    createElement('circle', { cx: 14.2, cy: 8, r: 1, fill: 'currentColor' }),
    createElement('circle', { cx: 8, cy: 14.2, r: 1, fill: 'currentColor' }),
    createElement('circle', { cx: 1.8, cy: 8, r: 1, fill: 'currentColor' }),
  )
}
```

`src/client/star.css`：

```css
/* 官方工具按钮同款配方（QueueDock .action 的 CSS 变量组合），深色主题自动适配。 */
.dsh-polish-entry { display: inline-flex; align-items: center; }
.dsh-polish-btn {
  width: 28px; height: 28px; color: var(--dsw-alias-label-tertiary); cursor: pointer;
  background: 0 0; border: none; border-radius: 999px; flex: none;
  place-items: center; padding: 0; display: grid;
}
.dsh-polish-btn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-polish-btn:focus-visible { outline: 2px solid var(--dsw-alias-label-tertiary); outline-offset: -2px; }
.dsh-polish-btn:disabled { cursor: default; opacity: .45; }
.dsh-polish-btn svg { width: 14px; height: 14px; display: block; }
@keyframes dsh-polish-spin { to { transform: rotate(360deg); } }
.dsh-polish-btn[data-busy] svg { animation: dsh-polish-spin .9s linear infinite; }
```

- [ ] **Step 2: 实现 client 入口 index.tsx**

`src/client/index.tsx`：

```tsx
/**
 * Client apply — dsh-polish 的 client 半入口。
 * 注册 conversation.input.left（order 31 → 书本图标 deepread order 30 右侧），
 * standard props 直读：useProjection('permissions') / useInput / inputActions。
 * 红线：slots.inject 回调必须返回 register 的 disposer；全部挂 ctx.effect dispose 链。
 */
import { createElement, useState } from 'react'
import { Toast, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Context } from 'cordis'
import { decidePolishAction, type PolishAction } from './state.js'
import { postJson, runPolishClick } from './orchestrate.js'
import { StarIcon } from './icon.js'
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
  register(options: { name: string; id: string; order?: number; label?: string }, component: unknown): () => void
}

type ClientCtx = Context & { slots: SlotsService }

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
    }).finally(() => setBusy(false))
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
      (props: Record<string, unknown>) => createElement(StarButton, props as never),
    ),
  )
  ctx.effect(() => () => {
    offSlot()
  }, 'dsh-polish: client lifecycle (slot entry)')
}
```

- [ ] **Step 3: tsdown.config.mjs 追加 client browser bundle**

在 `export default [` 数组末尾（node 配置之后）追加：

```js
  {
    entry: { client: 'src/client/index.tsx' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    dts: false,
    sourcemap: false,
    clean: false,
    external: CLIENT_EXTERNALS,
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
    },
    inputOptions: {
      resolve: {
        conditionNames: ['browser', 'import', 'require', 'default'],
      },
    },
    noExternal: (id) => (CLIENT_EXTERNALS.includes(id) ? undefined : true),
    plugins: [purityGatePlugin(), makeCssPlugin(PLUGIN_ID)],
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PLUGIN_ID)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
      codeSplitting: false,
    },
  },
```

- [ ] **Step 4: 构建 + 类型检查（本任务的验证周期）**

Run:
```
pnpm build
pnpm check
pnpm test
```
Expected: `lib/client.js` 生成且 banner 含 `__ModuleLoader__.load({ id: "dsh-polish"`；tsc host + client 全过；单测全绿（fence 9 + optimize 10 + handler 8 + state 6 + orchestrate 9）。抽查 `lib/client.js` 无 `node:` builtin 残留（purity gate 已在构建期兜底）。

- [ ] **Step 5: Commit**

```bash
cd D:\xgzhang\projects\dsh-plugins
git add packages/dsh-polish
git commit -m "feat(dsh-polish): client 四角星按钮组件（slot 注入 + Toast/Tooltip + 光标定位）"
```

---

### Task 6: 安装进 desktop profile + 验收

**Files:**
- Modify: `C:\Users\spadmin\.dsh\profiles\desktop\package.json`（经 `dsh plugin` CLI 自动改写）
- Modify: `C:\Users\spadmin\.dsh\profiles\desktop\cordis.yml` / `cordis.patch.yml`（CLI 自动）

**Interfaces:**
- Consumes: Task 5 `lib/client.js` + Task 3 `lib/index.js`
- Produces: desktop profile 生效的四角星按钮（用户可见交付物）

- [ ] **Step 1: 安装（link 协议，本地包不进 registry）**

Run（PowerShell）:
```
cd D:\xgzhang\projects\dsh-plugins\packages\dsh-polish
pnpm install
dsh plugin --profile desktop add "link:D:/xgzhang/projects/dsh-plugins/packages/dsh-polish"
```
Expected: 命令成功；`profiles\desktop\package.json` 的 dependencies 出现 `"dsh-polish": "link:..."` 且 `dsh.profile.bundles` 末尾出现 `"dsh-polish"`。
若 `dsh plugin` CLI 失败：手工在 profiles\desktop\package.json 加依赖与 bundle 条目后 `cd C:\Users\spadmin\.dsh\profiles\desktop && pnpm install`。

- [ ] **Step 2: 复查 @deepseek-ai junction（已知坑）**

Run（PowerShell）:
```
Get-ChildItem "C:\Users\spadmin\.dsh\profiles\desktop\node_modules\@deepseek-ai" | ForEach-Object { $_.Name + ' ' + $_.LinkType }
```
Expected: 无 `LinkType` 为空的**真实目录**副本（应全为 Junction 或不存在；2.0.3 下悬空 Junction = 安全）。若 pnpm install 重建了真实目录 → 删除并用 `cmd /c mklink /J` 重建悬空 junction（指向 `D:\xgzhang\resources\installed\DSH Desktop\resources\app.asar.unpacked\node_modules\@deepseek-ai\<pkg>`）。

- [ ] **Step 3: 重启 DSH Desktop 并验证插件加载**

Run: 完全退出 DSH Desktop 后重新启动。
Expected: 无启动报错；日志（`%APPDATA%\DSH Desktop\logs\`）无 `dsh-polish` 错误。

- [ ] **Step 4: 手动验收清单（逐项打勾）**

- [ ] 底部工具栏书本图标（📖 精读）右侧出现四角星按钮；细线空心、四角顶点小圆点、浅灰；尺寸/高度/间距与相邻按钮一致；深色主题下正常
- [ ] 鼠标悬浮显示 Tooltip「优化并细化当前用户输入」（延迟约 0.5s，样式与官方按钮 tooltip 一致）
- [ ] 权限下拉切到 Read Only → 按钮置灰、点击无任何动作；切回其他权限恢复
- [ ] 输入框为空（或纯空白）点击 → 顶部 Toast「请先输入内容再进行优化细化」，约 4s 自动消失
- [ ] 输入一段有语病/缺细节的中文 → 点击 → 按钮转 loading（旋转）→ 完成后输入框内容被整体替换（非追加）；光标在文本末尾，可直接继续输入
- [ ] 优化质量抽查：核心意图保留、逻辑通顺、无多余废话、语气与原输入一致、无模型自带的解释性前缀/后缀
- [ ] 机器回复运行中（phase 非 plain）按钮置灰；发送后恢复
- [ ] 原有功能回归：+新增、Read Only 下拉、书本图标（精读面板）、发送等一切正常

- [ ] **Step 5: 收尾 Commit**

```bash
cd D:\xgzhang\projects\dsh-plugins
git add packages/dsh-polish
git commit -m "docs(dsh-polish): 安装与验收记录" -m "desktop profile 实测通过清单" 
```
（如验收发现问题：修复对应源码 → `pnpm build` → 重启 DSH → 复测，全部通过后再提交。）

---

## Self-Review 记录

- Spec 覆盖：按钮位置（T5 order 31）/图标样式（T5 icon+css）/Tooltip 文案（T5）/只读置灰（T4+T5）/空输入 Toast（T4+T5）/覆盖替换+光标末尾（T4+T5）/优化规则（T2 system prompt）/原有功能不动（仅新增 slot entry，不 shadow 任何官方槽位）✓
- 占位符扫描：无 TBD/TODO；所有代码步骤含完整代码 ✓
- 类型一致性：`PolishAction`/`decidePolishAction`/`runPolishClick`/`postJson`/`EMPTY_HINT` 在 T4 定义、T5 消费，命名一致；`isTrustedPolishRequest` T1 定义 T3 消费；`OptimizeError` code 枚举 T2 定义 T2/T3 消费 ✓
