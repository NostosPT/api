import type { EnvConfig, LogLevel, NodeEnvironment } from "../types/config.js";

const LOG_LEVELS: LogLevel[] = ["fatal", "error", "warn", "info", "debug", "trace", "silent"];

function parseEnvironment(value: string | undefined): NodeEnvironment {
	if (
		value === "development" ||
		value === "production" ||
		value === "test"
	) {
		return value;
	}

	return "development";
}

function parsePort(value: string | undefined): number {
	const port = Number.parseInt(value ?? "3000", 10);

	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		throw new Error("Invalid PORT configuration");
	}

	return port;
}

function parsePositiveInt(value: string | undefined, name: string, fallback: number): number {
	if (value === undefined || value === "") {
		return fallback;
	}

	const parsed = Number.parseInt(value, 10);

	if (!Number.isInteger(parsed) || parsed <= 0) {
		throw new Error(`Invalid ${name} configuration`);
	}

	return parsed;
}

function parseLogLevel(value: string | undefined): LogLevel | undefined {
	if (value === undefined || value === "") {
		return undefined;
	}

	if (!LOG_LEVELS.includes(value as LogLevel)) {
		throw new Error("Invalid LOG_LEVEL configuration");
	}

	return value as LogLevel;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
	if (value === undefined || value === "") {
		return fallback;
	}

	if (value === "true" || value === "1") {
		return true;
	}

	if (value === "false" || value === "0") {
		return false;
	}

	throw new Error("Invalid boolean configuration value");
}

function optional(value: string | undefined): string | undefined {
	const trimmed = value?.trim();

	return trimmed ? trimmed : undefined;
}

function parseStorageProvider(value: string | undefined): "s3" {
	const provider = (value ?? "s3").trim().toLowerCase();

	if (provider === "" || provider === "s3") {
		return "s3";
	}

	throw new Error('Invalid STORAGE_PROVIDER configuration (only "s3" is supported)');
}

// Absolute http(s) URL without credentials, normalized without a trailing
// slash so paths can be appended.
function optionalHttpUrl(value: string | undefined, name: string): string | undefined {
	const trimmed = optional(value);

	if (trimmed === undefined) {
		return undefined;
	}

	let url: URL;

	try {
		url = new URL(trimmed);
	}
	catch {
		throw new Error(`Invalid ${name} configuration`);
	}

	if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) {
		throw new Error(`Invalid ${name} configuration`);
	}

	return url.toString().replace(/\/+$/, "");
}

// Deliberately strict: no whitespace or angle brackets, so values can never
// smuggle extra headers or recipients into an email request.
const EMAIL_PATTERN = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;

function parseEmailList(value: string | undefined, name: string): string[] {
	const emails = (value ?? "")
		.split(",")
		.map((email) => email.trim().toLowerCase())
		.filter(Boolean);

	if (emails.some((email) => !EMAIL_PATTERN.test(email))) {
		throw new Error(`Invalid ${name} configuration`);
	}

	return [...new Set(emails)];
}

// Accepts "alerts@example.com" or "Nostos Alerts <alerts@example.com>".
function parseSender(value: string | undefined, name: string): string | undefined {
	const trimmed = optional(value);

	if (trimmed === undefined) {
		return undefined;
	}

	const named = /^([^<>\r\n"]+?)\s*<([^<>]+)>$/.exec(trimmed);
	const address = named ? named[2] : trimmed;

	if (!EMAIL_PATTERN.test(address)) {
		throw new Error(`Invalid ${name} configuration`);
	}

	return trimmed;
}

function requiredSecret(name: string, minLength: number): string {
	const value = process.env[name];

	if (!value || value.length < minLength) {
		throw new Error(`Invalid ${name} configuration`);
	}

	return value;
}

export function validateEnv(): EnvConfig {
	const nodeEnv = parseEnvironment(process.env.NODE_ENV);
	const databaseUrl = process.env.DATABASE_URL ?? "";

	if (!databaseUrl.startsWith("postgresql://") && !databaseUrl.startsWith("postgres://")) {
		throw new Error("Invalid DATABASE_URL configuration");
	}

	const corsOrigins = (process.env.CORS_ORIGINS ?? "")
		.split(",")
		.map((origin) => origin.trim())
		.filter(Boolean);

	const s3PublicEndpoint = optional(process.env.S3_PUBLIC_ENDPOINT);
	const monitorPublicStorage = parseBoolean(process.env.MONITOR_PUBLIC_STORAGE, false);

	// The public storage probe reuses the presigning endpoint; enabling it
	// without one is a configuration mistake, not a silent no-op.
	if (monitorPublicStorage && s3PublicEndpoint === undefined) {
		throw new Error("Invalid MONITOR_PUBLIC_STORAGE configuration (requires S3_PUBLIC_ENDPOINT)");
	}

	const tlsDegradedDays = parsePositiveInt(process.env.MONITOR_TLS_DEGRADED_DAYS, "MONITOR_TLS_DEGRADED_DAYS", 14);
	const tlsDownDays = parsePositiveInt(process.env.MONITOR_TLS_DOWN_DAYS, "MONITOR_TLS_DOWN_DAYS", 3);

	if (tlsDownDays >= tlsDegradedDays) {
		throw new Error("Invalid MONITOR_TLS_DOWN_DAYS configuration (must be below MONITOR_TLS_DEGRADED_DAYS)");
	}

	const backupDegradedHours = parsePositiveInt(process.env.MONITOR_BACKUP_DEGRADED_HOURS, "MONITOR_BACKUP_DEGRADED_HOURS", 26);
	const backupDownHours = parsePositiveInt(process.env.MONITOR_BACKUP_DOWN_HOURS, "MONITOR_BACKUP_DOWN_HOURS", 50);

	if (backupDownHours <= backupDegradedHours) {
		throw new Error("Invalid MONITOR_BACKUP_DOWN_HOURS configuration (must exceed MONITOR_BACKUP_DEGRADED_HOURS)");
	}

	return {
		NODE_ENV: nodeEnv,
		HOST: process.env.HOST ?? "127.0.0.1",
		PORT: parsePort(process.env.PORT),
		CORS_ORIGINS: corsOrigins,
		DATABASE_URL: databaseUrl,
		COOKIE_SECRET: requiredSecret("COOKIE_SECRET", 32),
		TRUST_PROXY: (process.env.TRUST_PROXY ?? "").trim(),
		LOG_LEVEL: parseLogLevel(process.env.LOG_LEVEL),
		DOCS_ENABLED: parseBoolean(process.env.DOCS_ENABLED, nodeEnv !== "production"),
		SESSION_ABSOLUTE_SECONDS: parsePositiveInt(process.env.SESSION_ABSOLUTE_SECONDS, "SESSION_ABSOLUTE_SECONDS", 30 * 24 * 60 * 60),
		SESSION_IDLE_SECONDS: parsePositiveInt(process.env.SESSION_IDLE_SECONDS, "SESSION_IDLE_SECONDS", 7 * 24 * 60 * 60),
		SESSION_MAX_CONCURRENT: parsePositiveInt(process.env.SESSION_MAX_CONCURRENT, "SESSION_MAX_CONCURRENT", 10),
		UPLOAD_MAX_BYTES: parsePositiveInt(process.env.UPLOAD_MAX_BYTES, "UPLOAD_MAX_BYTES", 50 * 1024 * 1024),
		S3_ENDPOINT: optional(process.env.S3_ENDPOINT),
		S3_REGION: optional(process.env.S3_REGION),
		S3_BUCKET: optional(process.env.S3_BUCKET),
		S3_ACCESS_KEY_ID: optional(process.env.S3_ACCESS_KEY_ID),
		S3_SECRET_ACCESS_KEY: optional(process.env.S3_SECRET_ACCESS_KEY),
		S3_PUBLIC_ENDPOINT: s3PublicEndpoint,
		S3_FORCE_PATH_STYLE: parseBoolean(process.env.S3_FORCE_PATH_STYLE, false),
		STORAGE_PROVIDER: parseStorageProvider(process.env.STORAGE_PROVIDER),
		SITE_COPYRIGHT: optional(process.env.SITE_COPYRIGHT),
		MONITOR_ENABLED: parseBoolean(process.env.MONITOR_ENABLED, nodeEnv === "production"),
		MONITOR_PUBLIC_URL: optionalHttpUrl(process.env.MONITOR_PUBLIC_URL, "MONITOR_PUBLIC_URL"),
		MONITOR_PUBLIC_STORAGE: monitorPublicStorage,
		HEALTH_RETENTION_DAYS: parsePositiveInt(process.env.HEALTH_RETENTION_DAYS, "HEALTH_RETENTION_DAYS", 30),
		MONITOR_INTERVAL_DATABASE_SECONDS: parsePositiveInt(process.env.MONITOR_INTERVAL_DATABASE_SECONDS, "MONITOR_INTERVAL_DATABASE_SECONDS", 60),
		MONITOR_INTERVAL_STORAGE_SECONDS: parsePositiveInt(process.env.MONITOR_INTERVAL_STORAGE_SECONDS, "MONITOR_INTERVAL_STORAGE_SECONDS", 60),
		MONITOR_INTERVAL_STORAGE_WRITE_SECONDS: parsePositiveInt(process.env.MONITOR_INTERVAL_STORAGE_WRITE_SECONDS, "MONITOR_INTERVAL_STORAGE_WRITE_SECONDS", 60 * 60),
		MONITOR_INTERVAL_PUBLIC_SECONDS: parsePositiveInt(process.env.MONITOR_INTERVAL_PUBLIC_SECONDS, "MONITOR_INTERVAL_PUBLIC_SECONDS", 60),
		MONITOR_INTERVAL_TLS_SECONDS: parsePositiveInt(process.env.MONITOR_INTERVAL_TLS_SECONDS, "MONITOR_INTERVAL_TLS_SECONDS", 6 * 60 * 60),
		MONITOR_INTERVAL_BACKUP_SECONDS: parsePositiveInt(process.env.MONITOR_INTERVAL_BACKUP_SECONDS, "MONITOR_INTERVAL_BACKUP_SECONDS", 15 * 60),
		MONITOR_FAILURE_THRESHOLD: parsePositiveInt(process.env.MONITOR_FAILURE_THRESHOLD, "MONITOR_FAILURE_THRESHOLD", 3),
		MONITOR_RECOVERY_THRESHOLD: parsePositiveInt(process.env.MONITOR_RECOVERY_THRESHOLD, "MONITOR_RECOVERY_THRESHOLD", 2),
		MONITOR_TIMEOUT_MS: parsePositiveInt(process.env.MONITOR_TIMEOUT_MS, "MONITOR_TIMEOUT_MS", 5_000),
		MONITOR_PUBLIC_TIMEOUT_MS: parsePositiveInt(process.env.MONITOR_PUBLIC_TIMEOUT_MS, "MONITOR_PUBLIC_TIMEOUT_MS", 10_000),
		MONITOR_DATABASE_SLOW_MS: parsePositiveInt(process.env.MONITOR_DATABASE_SLOW_MS, "MONITOR_DATABASE_SLOW_MS", 500),
		MONITOR_STORAGE_SLOW_MS: parsePositiveInt(process.env.MONITOR_STORAGE_SLOW_MS, "MONITOR_STORAGE_SLOW_MS", 1_000),
		MONITOR_PUBLIC_SLOW_MS: parsePositiveInt(process.env.MONITOR_PUBLIC_SLOW_MS, "MONITOR_PUBLIC_SLOW_MS", 2_000),
		MONITOR_TLS_DEGRADED_DAYS: tlsDegradedDays,
		MONITOR_TLS_DOWN_DAYS: tlsDownDays,
		MONITOR_BACKUP_DEGRADED_HOURS: backupDegradedHours,
		MONITOR_BACKUP_DOWN_HOURS: backupDownHours,
		RESEND_API_KEY: optional(process.env.RESEND_API_KEY),
		ALERT_EMAIL_FROM: parseSender(process.env.ALERT_EMAIL_FROM, "ALERT_EMAIL_FROM"),
		ALERT_FALLBACK_RECIPIENTS: parseEmailList(process.env.ALERT_FALLBACK_RECIPIENTS, "ALERT_FALLBACK_RECIPIENTS"),
	};
}
