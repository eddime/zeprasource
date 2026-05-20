/** Split "host", "host:port", or "imap://host:port" into host + port. */
export function splitImapHostInput(
	hostInput: string,
	portInput: number | string,
): { host: string; port: number } {
	let host = hostInput.trim().replace(/^imap(s)?:\/\//i, "").split("/")[0] ?? "";
	let port = typeof portInput === "string" ? Number.parseInt(portInput, 10) : portInput;

	if (host.includes(":")) {
		const [hostPart, portPart] = host.split(":");
		host = hostPart ?? host;
		const parsed = Number.parseInt(portPart ?? "", 10);
		if (Number.isFinite(parsed) && parsed > 0) port = parsed;
	}

	host = host.replace(/^\[|\]$/g, "");
	if (/^localhost$/i.test(host)) host = "127.0.0.1";

	return {
		host,
		port: Number.isFinite(port) && port > 0 ? port : 993,
	};
}
