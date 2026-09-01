//#region src/optimize.ts
var OptimizeError = class extends Error {
	code;
	constructor(code, message, options) {
		super(message, options);
		this.code = code;
		this.name = "OptimizeError";
	}
};
const MODEL = "deepseek-v4-flash";
const BASE_URL = "https://api.deepseek.com";
const MAX_OUTPUT_TOKENS = 8192;
const SYSTEM_PROMPT = [
	"你是文本优化助手。请对用户提供的文本进行优化与细化：",
	"1. 保留用户原本的核心想法与意图，不得篡改原意；",
	"2. 理顺语句逻辑，修正语病，删除冗余废话；",
	"3. 补充缺失细节，扩充描述层次，使表达更完整、严谨、条理清晰；",
	"4. 维持原有语气风格，不强行改变文体。",
	"只输出优化后的完整文本，不要输出任何解释、标题或前后缀。"
].join("\n");
function buildOptimizePrompt(text) {
	return {
		model: MODEL,
		temperature: .3,
		stream: false,
		max_tokens: Math.min(Math.max(1024, Math.ceil(text.length * 2) + 512), MAX_OUTPUT_TOKENS),
		messages: [{
			role: "system",
			content: SYSTEM_PROMPT
		}, {
			role: "user",
			content: text
		}]
	};
}
async function ambientApiKey() {
	const value = process.env.DEEPSEEK_API_KEY;
	if (value !== void 0 && value.length > 0) return value;
	throw new OptimizeError("missing-credential", "dsh-polish: no API key \"DEEPSEEK_API_KEY\" — store it through the credentials service or set the DEEPSEEK_API_KEY environment variable");
}
async function callDeepSeekOptimize(text, deps = {}) {
	const fetchImpl = deps.fetchImpl ?? fetch;
	const resolveApiKey = deps.resolveApiKey ?? ambientApiKey;
	let apiKey;
	try {
		apiKey = await resolveApiKey();
	} catch (err) {
		if (err instanceof OptimizeError) throw err;
		throw new OptimizeError("missing-credential", err instanceof Error ? err.message : String(err), { cause: err });
	}
	let res;
	try {
		res = await fetchImpl(`${BASE_URL}/chat/completions`, {
			method: "POST",
			headers: {
				authorization: `Bearer ${apiKey}`,
				"content-type": "application/json",
				accept: "application/json"
			},
			body: JSON.stringify(buildOptimizePrompt(text))
		});
	} catch (err) {
		throw new OptimizeError("transport", `DeepSeek API request failed: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
	}
	if (!res.ok) {
		let message = `DeepSeek API error (HTTP ${res.status})`;
		try {
			const payload = await res.json();
			if (payload?.error?.message) message = payload.error.message;
		} catch {}
		throw new OptimizeError("api-error", message);
	}
	let payload;
	try {
		payload = await res.json();
	} catch (err) {
		throw new OptimizeError("api-error", "DeepSeek API returned a non-JSON body", { cause: err });
	}
	const content = payload?.choices?.[0]?.message?.content;
	if (typeof content !== "string" || content.trim() === "") throw new OptimizeError("empty-response", "DeepSeek API returned no content");
	return content;
}
//#endregion
export { BASE_URL, MAX_OUTPUT_TOKENS, MODEL, OptimizeError, buildOptimizePrompt, callDeepSeekOptimize };
