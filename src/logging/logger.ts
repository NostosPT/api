import pino from "pino";

// Shared redaction: applied to the process logger and the Fastify instance
// logger. Covers credentials, tokens, secrets and anything shaped like them.
// Request bodies are never logged by default.
export const redactPaths = [
	"req.headers.authorization",
	"req.headers.cookie",
	"res.headers.set-cookie",
	"*.password",
	"*.passwordHash",
	"*.tokenHash",
	"*.token",
	"*.accessCode",
	"*.secret",
	"*.clientSecret",
	"*.apiKey",
];

export function resolveLogLevel(): string {
	const configured = process.env.LOG_LEVEL;

	if (configured) {
		return configured;
	}

	if (process.env.NODE_ENV === "production") {
		return "info";
	}

	if (process.env.NODE_ENV === "test") {
		return "silent";
	}

	return "debug";
}

const processLogger = pino({
	level: resolveLogLevel(),
	redact: {
		paths: redactPaths,
		censor: "[Redacted]",
	},
});

export function debug(message: string, data?: unknown): void {
	if (data === undefined) {
		processLogger.debug(message);
	}
	else {
		processLogger.debug(data, message);
	}
}

export function info(message: string, data?: unknown): void {
	if (data === undefined) {
		processLogger.info(message);
	}
	else {
		processLogger.info(data, message);
	}
}

export function warn(message: string, data?: unknown): void {
	if (data === undefined) {
		processLogger.warn(message);
	}
	else {
		processLogger.warn(data, message);
	}
}

export function error(message: string, data?: unknown): void {
	if (data === undefined) {
		processLogger.error(message);
	}
	else {
		processLogger.error(data, message);
	}
}

// Logs only — never exits the process. Shutdown/exit policy belongs to the
// caller (see core/shutdown.ts).
export function fatal(message: string, data?: unknown): void {
	if (data === undefined) {
		processLogger.fatal(message);
	}
	else {
		processLogger.fatal(data, message);
	}
}
