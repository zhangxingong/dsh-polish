window.__ModuleLoader__.load({
	id: "dsh-polish",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		//#region src/client/state.ts
		function decidePolishAction(permission, phase, draft) {
			if (permission === "read-only" || phase === "submitting" || phase === "adjudicating") return "disabled";
			if (draft.trim() === "") return "empty";
			return "ready";
		}
		//#endregion
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
			const result = await glue.post(draft);
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
		//#region src/client/icon.tsx
		/** 四角星图标：细线空心 + 四角顶点小圆点（浅灰 currentColor，无填充）。 */
		function StarIcon() {
			return (0, react.createElement)("svg", {
				width: 14,
				height: 14,
				viewBox: "0 0 16 16",
				fill: "none",
				"aria-hidden": true
			}, (0, react.createElement)("path", {
				d: "M8 1.8 L9.4 6.6 L14.2 8 L9.4 9.4 L8 14.2 L6.6 9.4 L1.8 8 L6.6 6.6 Z",
				stroke: "currentColor",
				strokeWidth: 1.2,
				strokeLinejoin: "round",
				fill: "none"
			}), (0, react.createElement)("circle", {
				cx: 8,
				cy: 1.8,
				r: 1,
				fill: "currentColor"
			}), (0, react.createElement)("circle", {
				cx: 14.2,
				cy: 8,
				r: 1,
				fill: "currentColor"
			}), (0, react.createElement)("circle", {
				cx: 8,
				cy: 14.2,
				r: 1,
				fill: "currentColor"
			}), (0, react.createElement)("circle", {
				cx: 1.8,
				cy: 8,
				r: 1,
				fill: "currentColor"
			}));
		}
		//#endregion
		//#region \0dsh-css:src\client\star.css.mjs
		const css = "/* 官方工具按钮同款配方（QueueDock .action 的 CSS 变量组合），深色主题自动适配。 */\n.dsh-polish-entry { display: inline-flex; align-items: center; }\n.dsh-polish-btn {\n  width: 28px; height: 28px; color: var(--dsw-alias-label-tertiary); cursor: pointer;\n  background: 0 0; border: none; border-radius: 999px; flex: none;\n  place-items: center; padding: 0; display: grid;\n}\n.dsh-polish-btn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }\n.dsh-polish-btn:focus-visible { outline: 2px solid var(--dsw-alias-label-tertiary); outline-offset: -2px; }\n.dsh-polish-btn:disabled { cursor: default; opacity: .45; }\n.dsh-polish-btn svg { width: 14px; height: 14px; display: block; }\n@keyframes dsh-polish-spin { to { transform: rotate(360deg); } }\n.dsh-polish-btn[data-busy] svg { animation: dsh-polish-spin .9s linear infinite; }\n";
		const tagId = "dsh-polish/star.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-polish";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		//#endregion
		//#region src/client/index.tsx
		/**
		* Client apply — dsh-polish 的 client 半入口。
		* 注册 conversation.input.left（order 31 → 书本图标 deepread order 30 右侧），
		* standard props 直读：useProjection('permissions') / useInput / inputActions。
		* 红线：slots.inject 回调必须返回 register 的 disposer；全部挂 ctx.effect dispose 链。
		*/
		const inject = ["slots"];
		const TOOLTIP = "优化并细化当前用户输入";
		/** DOM 锚点：composer textarea 带 data-phase（官方属性）。 */
		function findComposerTextarea() {
			const active = document.activeElement;
			if (active instanceof HTMLTextAreaElement && active.hasAttribute("data-phase")) return active;
			return document.querySelector("textarea[data-phase]");
		}
		function StarButton(props) {
			const draft = props.useInput((s) => s?.draft ?? "") ?? "";
			const phase = props.useInput((s) => s?.phase ?? "plain") ?? "plain";
			const action = decidePolishAction(props.useProjection("permissions")?.currentValue, phase, draft);
			const draftRef = (0, react.useRef)(draft);
			draftRef.current = draft;
			const [busy, setBusy] = (0, react.useState)(false);
			const [toast, setToast] = (0, react.useState)(null);
			const disabled = action === "disabled" || busy;
			const focusEnd = () => {
				const ta = findComposerTextarea();
				if (ta === null) return;
				ta.focus();
				requestAnimationFrame(() => {
					const end = ta.value.length;
					ta.setSelectionRange(end, end);
				});
			};
			const onClick = () => {
				if (disabled) return;
				setBusy(true);
				runPolishClick(action, draft, {
					post: (text) => postJson("/dsh-polish/optimize", { text }),
					setDraft: (text) => props.inputActions.setDraft(text),
					focusEnd,
					notify: (text) => setToast({
						seq: Date.now(),
						text
					}),
					getCurrentDraft: () => draftRef.current
				}).catch(() => setToast({
					seq: Date.now(),
					text: "优化失败，请稍后重试"
				})).finally(() => setBusy(false));
			};
			return (0, react.createElement)("div", { className: "dsh-polish-entry" }, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
				label: TOOLTIP,
				side: "top",
				delayMs: 500
			}, (0, react.createElement)("button", {
				type: "button",
				className: "dsh-polish-btn",
				"aria-label": TOOLTIP,
				disabled,
				"data-busy": busy || void 0,
				onClick
			}, (0, react.createElement)(StarIcon))), toast !== null && (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Toast, {
				key: toast.seq,
				text: toast.text,
				onDone: () => setToast(null)
			}));
		}
		function apply(ctx) {
			const offSlot = ctx.slots.inject("conversation.input.left", () => ctx.slots.register({
				name: "conversation.input.left",
				id: "polish-composer",
				order: 31,
				label: TOOLTIP
			}, (props) => (0, react.createElement)(StarButton, props)));
			ctx.effect(() => () => {
				offSlot();
			}, "dsh-polish: client lifecycle (slot entry)");
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
