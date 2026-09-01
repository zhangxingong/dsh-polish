import { OptimizeError, callDeepSeekOptimize } from "./optimize.js";
import { createPolishHandler } from "./handler.js";
//#region src/index.ts
const API_KEY_REF = "DEEPSEEK_API_KEY";
const name = "dsh-polish";
const inject = ["webServer"];
async function resolveApiKey(ctx) {
	const credentials = ctx.get("credentials");
	if (credentials !== void 0) {
		const hit = await credentials.resolve(API_KEY_REF);
		if (hit !== void 0 && hit.value.length > 0) return hit.value;
	}
	const ambient = process.env[API_KEY_REF];
	if (ambient !== void 0 && ambient.length > 0) return ambient;
	throw new OptimizeError("missing-credential", `dsh-polish: no API key "${API_KEY_REF}" — store it through the credentials service or set the ${API_KEY_REF} environment variable`);
}
function apply(ctx) {
	const handler = createPolishHandler(ctx, { optimize: (text) => callDeepSeekOptimize(text, { resolveApiKey: () => resolveApiKey(ctx) }) });
	const webServer = ctx.webServer;
	if (!webServer || typeof webServer.register !== "function") {
		ctx.logger.warn("[dsh-polish] webServer service unavailable; /dsh-polish routes are not mounted");
		return;
	}
	let dispose;
	try {
		dispose = webServer.register({
			kind: "prefix",
			path: "/dsh-polish",
			handler
		});
	} catch (err) {
		ctx.logger.warn("[dsh-polish] failed to mount /dsh-polish routes: %s", String(err));
		return;
	}
	ctx.effect(() => dispose);
}
//#endregion
export { apply, inject, name };
