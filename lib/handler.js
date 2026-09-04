import { isTrustedPolishRequest } from "./trust-fence.js";
import { OptimizeError, callDeepSeekOptimize } from "./optimize.js";
//#region src/handler.ts
const MAX_BODY_BYTES = 50331648;
const MAX_TEXT_BYTES = 204800;
const MAX_IMAGES_PER_REQUEST = 20;
const MAX_IMAGE_BYTES = 33554432;
const ACCEPTED_IMAGE_MEDIA_TYPES = [
	"image/png",
	"image/jpeg",
	"image/webp",
	"image/gif"
];
function sendJson(res, status, json) {
	res.writeHead(status, { "content-type": "application/json" });
	res.end(JSON.stringify(json));
}
function sendPlain(res, status, text, extraHeaders = {}) {
	res.writeHead(status, extraHeaders);
	res.end(text);
}
/** 消费请求体，字节精确（多字节 UTF-8 不会滑过上限）。永不 reject。 */
async function readRequestBody(req, limit = MAX_BODY_BYTES) {
	const declared = Number(req.headers["content-length"]);
	if (Number.isFinite(declared) && declared > limit) return {
		ok: false,
		code: "too-large"
	};
	try {
		const chunks = [];
		let size = 0;
		for await (const chunk of req) {
			const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
			size += buf.byteLength;
			if (size > limit) return {
				ok: false,
				code: "too-large"
			};
			chunks.push(buf);
		}
		return {
			ok: true,
			body: Buffer.concat(chunks).toString("utf8")
		};
	} catch {
		return {
			ok: false,
			code: "read-failed"
		};
	}
}
function createPolishHandler(ctx, opts = {}) {
	const optimize = opts.optimize ?? ((text, images = []) => callDeepSeekOptimize(text, { images }));
	return async (req, res) => {
		try {
			if (!isTrustedPolishRequest(req)) {
				sendPlain(res, 403, "forbidden");
				return;
			}
			if (req.method !== "POST") {
				sendPlain(res, 405, "method not allowed", { allow: "POST" });
				return;
			}
			if ((req.url ?? "").split("?")[0] !== "/dsh-polish/optimize") {
				sendPlain(res, 404, "not found");
				return;
			}
			const read = await readRequestBody(req);
			if (!read.ok) {
				if (read.code === "read-failed") {
					sendJson(res, 400, {
						ok: false,
						code: "bad-request",
						message: "request body read failed"
					});
					return;
				}
				sendJson(res, 413, {
					ok: false,
					code: "payload-too-large",
					message: `request body exceeds ${MAX_BODY_BYTES} bytes`
				});
				return;
			}
			let body;
			try {
				body = JSON.parse(read.body);
			} catch {
				sendJson(res, 400, {
					ok: false,
					code: "bad-request",
					message: "invalid JSON"
				});
				return;
			}
			const obj = typeof body === "object" && body !== null ? body : {};
			const text = obj.text;
			if (typeof text !== "string") {
				sendJson(res, 400, {
					ok: false,
					code: "invalid-text",
					message: "text must be a string"
				});
				return;
			}
			if (text.trim().length === 0) {
				sendJson(res, 400, {
					ok: false,
					code: "empty-text",
					message: "text must not be empty"
				});
				return;
			}
			if (Buffer.byteLength(text, "utf8") > 204800) {
				sendJson(res, 400, {
					ok: false,
					code: "text-too-large",
					message: `text exceeds ${MAX_TEXT_BYTES} utf8 bytes`
				});
				return;
			}
			const imagesRaw = obj.images ?? [];
			if (!Array.isArray(imagesRaw)) {
				sendJson(res, 400, {
					ok: false,
					code: "invalid-images",
					message: "images must be an array"
				});
				return;
			}
			if (imagesRaw.length > 20) {
				sendJson(res, 400, {
					ok: false,
					code: "too-many-images",
					message: `at most 20 images per request`
				});
				return;
			}
			const images = [];
			for (const item of imagesRaw) {
				const candidate = typeof item === "object" && item !== null ? item : {};
				if (typeof candidate.mediaType !== "string" || !ACCEPTED_IMAGE_MEDIA_TYPES.includes(candidate.mediaType) || typeof candidate.data !== "string") {
					sendJson(res, 400, {
						ok: false,
						code: "invalid-image",
						message: "each image must be {mediaType, data} with a supported mediaType"
					});
					return;
				}
				if (Buffer.from(candidate.data, "base64").byteLength > 33554432) {
					sendJson(res, 400, {
						ok: false,
						code: "image-too-large",
						message: `each image must decode to at most ${MAX_IMAGE_BYTES} bytes`
					});
					return;
				}
				images.push({
					mediaType: candidate.mediaType,
					data: candidate.data
				});
			}
			try {
				sendJson(res, 200, {
					ok: true,
					text: await optimize(text, images)
				});
			} catch (err) {
				const code = err instanceof OptimizeError ? err.code : "internal-error";
				const message = err instanceof OptimizeError ? err.message : "optimization failed";
				ctx.logger.warn("[dsh-polish] optimize failed: %s", String(err));
				sendJson(res, 502, {
					ok: false,
					code,
					message
				});
			}
		} catch (err) {
			ctx.logger.error("[dsh-polish] request failed: %s", String(err));
			try {
				if (res.headersSent) res.end();
				else sendJson(res, 400, {
					ok: false,
					code: "bad-request",
					message: "request failed"
				});
			} catch {}
		}
	};
}
//#endregion
export { MAX_BODY_BYTES, MAX_IMAGES_PER_REQUEST, MAX_IMAGE_BYTES, MAX_TEXT_BYTES, createPolishHandler, readRequestBody };
