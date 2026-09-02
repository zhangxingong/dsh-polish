import { CARD_INITIAL, cardReduce } from "./settings-state.js";
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
export { createPolishCardStore };
