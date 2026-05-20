type LogLevel = "info" | "warn" | "error" | "debug";

const REDACT_PATTERNS = [
	/password[=:]\s*\S+/gi,
	/oauth[=:]\s*\S+/gi,
	/Bearer\s+\S+/gi,
];

function redact(message: string): string {
	let result = message;
	for (const pattern of REDACT_PATTERNS) {
		result = result.replace(pattern, "[REDACTED]");
	}
	return result;
}

function log(level: LogLevel, scope: string, message: string, meta?: unknown): void {
	const prefix = `[Zepra:${scope}]`;
	const safeMessage = redact(message);
	if (meta !== undefined) {
		console[level](prefix, safeMessage, typeof meta === "string" ? redact(meta) : meta);
	} else {
		console[level](prefix, safeMessage);
	}
}

export const logger = {
	info: (scope: string, message: string, meta?: unknown) => log("info", scope, message, meta),
	warn: (scope: string, message: string, meta?: unknown) => log("warn", scope, message, meta),
	error: (scope: string, message: string, meta?: unknown) => log("error", scope, message, meta),
	debug: (scope: string, message: string, meta?: unknown) => log("debug", scope, message, meta),
};
