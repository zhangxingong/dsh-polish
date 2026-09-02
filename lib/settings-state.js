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
export { CARD_INITIAL, cardReduce };
