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
