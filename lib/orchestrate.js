//#region src/client/orchestrate.ts
async function postJson(path, body, fetchImpl = fetch) {
	let res;
	try {
		res = await fetchImpl(path, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body ?? {}),
			signal: AbortSignal.timeout(3e4)
		});
	} catch (err) {
		return {
			ok: false,
			message: err instanceof Error ? err.message : String(err)
		};
	}
	if (!res.ok) {
		try {
			const parsed = await res.json();
			if (typeof parsed === "object" && parsed !== null && typeof parsed.message === "string") return {
				ok: false,
				message: `请求失败：${parsed.message}`
			};
		} catch {}
		return {
			ok: false,
			message: `请求失败（HTTP ${res.status}）`
		};
	}
	let json;
	try {
		json = await res.json();
	} catch {
		return {
			ok: false,
			message: "宿主返回了非 JSON 响应"
		};
	}
	if (typeof json !== "object" || json === null) return {
		ok: false,
		message: "宿主返回了异常响应"
	};
	return json;
}
const EMPTY_HINT = "请先输入内容再进行优化细化";
async function runPolishClick(action, draft, glue) {
	if (action === "empty") {
		glue.notify(EMPTY_HINT);
		return;
	}
	if (action !== "ready") return;
	let images = [];
	if (glue.resolveImages !== void 0) try {
		images = await glue.resolveImages();
	} catch (err) {
		glue.notify(err instanceof Error ? err.message : String(err));
		return;
	}
	const result = await glue.post(draft, images);
	if (result.ok && typeof result.text === "string" && result.text.trim().length > 0) {
		const current = glue.getCurrentDraft?.();
		if (current !== void 0 && current !== draft) {
			glue.notify("输入已变化，未覆盖");
			return;
		}
		glue.setDraft(result.text);
		glue.focusEnd();
	} else glue.notify(result.message ?? "优化失败，请稍后重试");
}
//#endregion
export { EMPTY_HINT, postJson, runPolishClick };
