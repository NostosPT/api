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
		S3_PUBLIC_ENDPOINT: optional(process.env.S3_PUBLIC_ENDPOINT),
		S3_FORCE_PATH_STYLE: parseBoolean(process.env.S3_FORCE_PATH_STYLE, false),
		STORAGE_PROVIDER: parseStorageProvider(process.env.STORAGE_PROVIDER),
		SITE_COPYRIGHT: optional(process.env.SITE_COPYRIGHT),
	};
}
