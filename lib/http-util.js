//#region src/http-util.ts
/** Host/authority parsing helpers for the trust fence (official /api fence 同源移植)。 */
function isLoopbackHostname(hostname) {
	if (hostname === "localhost" || hostname === "[::1]") return true;
	const parts = hostname.split(".");
	return parts.length === 4 && parts[0] === "127" && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}
function parseAuthority(authority) {
	try {
		const url = new URL(`http://${authority}`);
		return {
			hostname: url.hostname,
			host: url.host
		};
	} catch {
		return;
	}
}
//#endregion
export { isLoopbackHostname, parseAuthority };
