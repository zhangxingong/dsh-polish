import { isLoopbackHostname, parseAuthority } from "./http-util.js";
//#region src/trust-fence.ts
function isTrustedPolishRequest(req) {
	const host = req.headers["host"];
	if (typeof host !== "string" || host.length === 0) return false;
	const hostUrl = parseAuthority(host);
	if (hostUrl === void 0) return false;
	if (!isLoopbackHostname(hostUrl.hostname)) return false;
	const secFetchSite = req.headers["sec-fetch-site"];
	if (typeof secFetchSite === "string" && secFetchSite.toLowerCase() === "cross-site") return false;
	const origin = req.headers["origin"];
	if (origin === void 0 || origin === null) return true;
	try {
		return new URL(String(origin)).host === hostUrl.host;
	} catch {
		return false;
	}
}
//#endregion
export { isTrustedPolishRequest };
