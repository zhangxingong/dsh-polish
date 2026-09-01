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
