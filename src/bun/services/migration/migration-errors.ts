export type MigrationErrorKind =
	| "auth"
	| "quota"
	| "timeout"
	| "connection_lost"
	| "throttled"
	| "network"
	| "unknown";

export type MigrationErrorClassification = {
	kind: MigrationErrorKind;
	retryable: boolean;
	reconnect: boolean;
	userMessage: string;
};

type ImapLikeError = Error & {
	responseText?: string;
	authenticationFailed?: boolean;
	code?: string;
	serverResponseCode?: string;
};

function textFromError(error: unknown): string {
	if (!(error instanceof Error)) return String(error);
	const err = error as ImapLikeError;
	return [
		err.message,
		err.responseText,
		err.code,
		err.serverResponseCode,
		err.authenticationFailed ? "authenticationFailed" : "",
	]
		.filter(Boolean)
		.join(" ");
}

export function classifyMigrationError(
	error: unknown,
): MigrationErrorClassification {
	const text = textFromError(error);

	if (/AUTHENTICATIONFAILED|Invalid credentials|LOGIN failed|Authentication failed|authenticationFailed/i.test(text)) {
		return {
			kind: "auth",
			retryable: false,
			reconnect: false,
			userMessage: "Login failed. Check email and password, then try again.",
		};
	}

	if (/OVERQUOTA|quota exceeded|mailbox is full|insufficient storage/i.test(text)) {
		return {
			kind: "quota",
			retryable: false,
			reconnect: false,
			userMessage: "The destination mailbox does not have enough storage.",
		};
	}

	if (/rate limit|too many|throttl|temporarily unavailable|\[LIMIT\]|TRYLATER|UNAVAILABLE/i.test(text)) {
		return {
			kind: "throttled",
			retryable: true,
			reconnect: false,
			userMessage: "The provider is slowing us down, so Zepra will continue safely.",
		};
	}

	if (/ETIMEOUT|timeout|Socket timeout/i.test(text)) {
		return {
			kind: "timeout",
			retryable: true,
			reconnect: false,
			userMessage: "The server timed out. Zepra will retry locally.",
		};
	}

	if (/socket closed|connection closed|ECONNRESET|EPIPE|BYE/i.test(text)) {
		return {
			kind: "connection_lost",
			retryable: true,
			reconnect: true,
			userMessage: "The connection dropped. Zepra will reconnect locally.",
		};
	}

	if (/ENOTFOUND|getaddrinfo|ECONNREFUSED|ENETUNREACH|EAI_AGAIN/i.test(text)) {
		return {
			kind: "network",
			retryable: true,
			reconnect: true,
			userMessage: "The network connection failed. Zepra will retry locally.",
		};
	}

	return {
		kind: "unknown",
		retryable: true,
		reconnect: false,
		userMessage: error instanceof Error ? error.message : "Transfer failed",
	};
}
