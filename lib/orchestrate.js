//#region src/client/orchestrate.ts
async function postJson(path, body, fetchImpl = fetch) {
	let res;
	try {
		res = await fetchImpl(path, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body ?? {})
		});
	} catch (err) {
		return {
			ok: false,
			message: err instanceof Error ? err.message : String(err)
		};
	}
	if (!res.ok) return {
		ok: false,
		message: `请求失败（HTTP ${res.status}）`
	};
	let json;
	try {
		json = await res.json();
	} catch {
		return {
			ok: false,
			message: "宿主返回了非 JSON 响应"
		};
	}
	return json;
}
const EMPTY_HINT = "请先输入内容再进行优化细化";
async function runPolishClick(action, draft, glue) {
	if (action === "empty") {
		glue.notify(EMPTY_HINT);
		return;
	}
	if (action !== "ready") return;
	const result = await glue.post(draft);
	if (result.ok && typeof result.text === "string" && result.text.length > 0) {
		glue.setDraft(result.text);
		glue.focusEnd();
	} else glue.notify(result.message ?? "优化失败，请稍后重试");
}
//#endregion
export { EMPTY_HINT, postJson, runPolishClick };
