//#region src/client/state.ts
function decidePolishAction(permission, phase, draft) {
	if (permission === "read-only" || phase === "submitting" || phase === "adjudicating") return "disabled";
	if (draft.trim() === "") return "empty";
	return "ready";
}
//#endregion
export { decidePolishAction };
