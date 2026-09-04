window.__ModuleLoader__.load({
	id: "dsh-polish",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let _deepseek_ai_dsh_client_runtime_client = require("@deepseek-ai/dsh-client-runtime/client");
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
		//#region src/client/settings-state.ts
		const CARD_INITIAL = {
			status: "loading",
			draft: "",
			dirty: false,
			saving: false,
			saved: false,
			error: null,
			writable: true
		};
		function cardReduce(state, event) {
			switch (event.kind) {
				case "scope": return {
					...state,
					status: event.status,
					writable: event.writable && event.status === "ready",
					draft: state.dirty ? state.draft : event.value
				};
				case "edit": return {
					...state,
					draft: event.draft,
					dirty: true,
					saved: false,
					error: null
				};
				case "save-start": return {
					...state,
					saving: true,
					saved: false,
					error: null
				};
				case "save-ok": return {
					...state,
					saving: false,
					saved: true,
					dirty: false
				};
				case "save-fail": return {
					...state,
					saving: false,
					error: event.message
				};
				case "discard": return {
					...state,
					draft: event.value,
					dirty: false,
					saved: false,
					error: null
				};
				default: return state;
			}
		}
		//#endregion
		//#region src/client/settings-card-store.ts
		/**
		* 「个性化优化」设置卡片的 store（纯逻辑，store 工厂可注入供 node 测试）。
		* 平台契约：createSnapshotStore.update 是 immer 包装（mutator 返回值被丢弃，
		* 只采纳 draft 原地变更）——纯 reducer 与它不兼容，本模块一律走 set(nextState)。
		*/
		function scopePrompt(snap) {
			return snap.value?.systemPrompt ?? snap.base?.systemPrompt ?? "";
		}
		function createPolishCardStore(scope, makeStore) {
			const store = makeStore(CARD_INITIAL);
			const dispatch = (event) => {
				store.set(cardReduce(store.getSnapshot(), event));
			};
			const dispatchScope = (snap) => {
				dispatch({
					kind: "scope",
					status: snap.status,
					value: scopePrompt(snap),
					writable: snap.writable
				});
			};
			dispatchScope(scope.getSnapshot());
			scope.subscribe(dispatchScope);
			return {
				getSnapshot: store.getSnapshot,
				subscribe: store.subscribe,
				edit: (draft) => dispatch({
					kind: "edit",
					draft
				}),
				save: async () => {
					const draft = store.getSnapshot().draft;
					dispatch({ kind: "save-start" });
					const target = draft.trim();
					let ok = false;
					try {
						if (target === "") {
							await scope.unset("systemPrompt");
							ok = scope.getSnapshot().user?.systemPrompt === void 0;
						} else {
							await scope.set("systemPrompt", target);
							ok = scope.getSnapshot().user?.systemPrompt === target;
						}
					} catch {
						ok = false;
					}
					dispatch(ok ? { kind: "save-ok" } : {
						kind: "save-fail",
						message: "设置写入失败"
					});
				},
				discard: () => dispatch({
					kind: "discard",
					value: scopePrompt(scope.getSnapshot())
				})
			};
		}
		//#endregion
		//#region \0dsh-css:src\client\settings-card.css.mjs
		const css$1 = ".dsh-polish-settings {\n  display: grid;\n  gap: 10px;\n  color: var(--dsw-alias-label-primary);\n}\n\n.dsh-polish-settings-title {\n  margin: 0;\n  font-size: 14px;\n  font-weight: 600;\n}\n\n.dsh-polish-settings-textarea {\n  width: 100%;\n  box-sizing: border-box;\n  font-family: var(--dsw-alias-font-mono, ui-monospace, SFMono-Regular, Consolas, monospace);\n  font-size: 12px;\n  line-height: 1.6;\n  background: var(--dsw-alias-bg-base);\n  border: 1px solid var(--dsw-alias-border-l1);\n  border-radius: 6px;\n  padding: 8px;\n  color: var(--dsw-alias-label-primary);\n  resize: vertical;\n}\n\n.dsh-polish-settings-textarea:disabled {\n  opacity: 0.6;\n  cursor: not-allowed;\n}\n\n.dsh-polish-settings-row {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n}\n\n.dsh-polish-settings-save,\n.dsh-polish-settings-discard {\n  height: 28px;\n  padding: 0 14px;\n  border: 1px solid var(--dsw-alias-border-l1);\n  border-radius: 6px;\n  background: var(--dsw-alias-bg-layer-1);\n  color: var(--dsw-alias-label-primary);\n  font: inherit;\n  font-size: 12px;\n  cursor: pointer;\n}\n\n.dsh-polish-settings-save {\n  border-color: var(--dsw-alias-state-business-primary);\n  color: var(--dsw-alias-state-business-primary);\n}\n\n.dsh-polish-settings-save:hover:not(:disabled) {\n  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 10%, transparent);\n}\n\n.dsh-polish-settings-save:disabled,\n.dsh-polish-settings-discard:disabled {\n  opacity: 0.5;\n  cursor: default;\n}\n\n.dsh-polish-settings-status {\n  margin-left: auto;\n  font-size: 12px;\n}\n\n.dsh-polish-settings-status.saved {\n  color: var(--dsw-alias-state-success-primary);\n}\n\n.dsh-polish-settings-status.error {\n  color: var(--dsw-alias-state-error-primary);\n}\n\n.dsh-polish-settings-status.muted {\n  color: var(--dsw-alias-label-secondary);\n}\n";
		const tagId$1 = "dsh-polish/settings-card.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$1) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-polish";
			tag.dataset.pluginCss = tagId$1;
			tag.textContent = css$1;
			document.head.appendChild(tag);
		}
		//#endregion
		//#region src/client/settings-card.tsx
		/**
		* 「个性化优化」设置卡片组件。store 逻辑见 settings-card-store.ts（纯模块，node 可测）。
		* 类型全部结构化；无 @deepseek-ai value import。
		*/
		const CARD_TITLE = "个性化优化";
		function PolishSettingsCard(props) {
			const snap = props.usePolishCard((s) => s);
			const locked = snap.saving || snap.status === "unavailable" || !snap.writable;
			const canSave = !snap.saving && snap.dirty;
			const canDiscard = !snap.saving && (snap.dirty || snap.error !== null);
			let statusLine = null;
			if (snap.saved) statusLine = (0, react.createElement)("span", { className: "dsh-polish-settings-status saved" }, "已保存");
			else if (snap.error !== null) statusLine = (0, react.createElement)("span", { className: "dsh-polish-settings-status error" }, `保存失败：${snap.error}`);
			else if (snap.status === "loading") statusLine = (0, react.createElement)("span", { className: "dsh-polish-settings-status muted" }, "加载中…");
			return (0, react.createElement)("section", { className: "dsh-polish-settings" }, (0, react.createElement)("h3", { className: "dsh-polish-settings-title" }, CARD_TITLE), (0, react.createElement)("textarea", {
				className: "dsh-polish-settings-textarea",
				rows: 12,
				value: snap.draft,
				disabled: locked,
				onChange: (event) => props.edit(event.target.value)
			}), (0, react.createElement)("div", { className: "dsh-polish-settings-row" }, (0, react.createElement)("button", {
				type: "button",
				className: "dsh-polish-settings-save",
				disabled: !canSave,
				onClick: () => void props.save()
			}, "保存"), (0, react.createElement)("button", {
				type: "button",
				className: "dsh-polish-settings-discard",
				disabled: !canDiscard,
				onClick: () => props.discard()
			}, "放弃"), statusLine));
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
		const TOOLTIP = "智能优化：让你的输入更精准";
		/** DOM 锚点：composer textarea 带 data-phase（官方属性）。 */
		function findComposerTextarea() {
			const active = document.activeElement;
			if (active instanceof HTMLTextAreaElement && active.hasAttribute("data-phase")) return active;
			return document.querySelector("textarea[data-phase]");
		}
		function StarButton(props) {
			const draft = props.useInput((s) => s?.draft ?? "") ?? "";
			const phase = props.useInput((s) => s?.phase ?? "plain") ?? "plain";
			const imageIds = props.useInput((s) => s?.imageIds ?? []) ?? [];
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
					post: (text, images) => postJson("/dsh-polish/optimize", {
						text,
						images
					}),
					resolveImages: async () => {
						if (imageIds.length === 0) return [];
						if (props.serializeImages === void 0) throw new Error("附件服务不可用，无法识别图片");
						return props.serializeImages(imageIds);
					},
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
			ctx.inject(["conversation"], (cctx) => {
				const conversation = cctx.conversation;
				const offSlot = ctx.slots.inject("conversation.input.left", () => ctx.slots.register({
					name: "conversation.input.left",
					id: "polish-composer",
					order: 31,
					label: TOOLTIP
				}, (props) => (0, react.createElement)(StarButton, {
					...props,
					serializeImages: conversation === void 0 ? void 0 : (ids) => conversation.serializeDraftImages(ids)
				})));
				return () => {
					offSlot();
				};
			});
			ctx.inject(["settingsScope"], (sctx) => {
				const scoped = sctx;
				const scopeService = scoped.settingsScope;
				if (scopeService === void 0) return;
				const store = createPolishCardStore(scopeService.bind({ namespace: "polish" }), (init) => (0, _deepseek_ai_dsh_client_runtime_client.createSnapshotStore)(init));
				const off = scoped.slots.inject("settings.plugin.item", () => scoped.slots.register({
					name: "settings.plugin.item",
					key: "polish",
					inject: () => ({
						hooks: { polishCard: store },
						edit: (draft) => store.edit(draft),
						save: () => store.save(),
						discard: () => store.discard()
					})
				}, (props) => (0, react.createElement)(PolishSettingsCard, props)));
				return () => {
					off();
				};
			});
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
