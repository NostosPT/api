import "../test/env.js";
import { afterEach, describe, expect, it } from "vitest";
import { validateEnv } from "./env.js";

const snapshot = { ...process.env };

afterEach(() => {
	for (const key of Object.keys(process.env)) {
		if (!(key in snapshot)) {
			delete process.env[key];
		}
	}

	for (const [key, value] of Object.entries(snapshot)) {
		process.env[key] = value;
	}
});

function validBase(): void {
	process.env.NODE_ENV = "test";
	process.env.HOST = "127.0.0.1";
	process.env.PORT = "3000";
	process.env.CORS_ORIGINS = "";
	process.env.DATABASE_URL = "postgresql://nostos:nostos@localhost:5432/nostos_test";
	process.env.COOKIE_SECRET = "0123456789abcdef0123456789abcdef";
}

describe("validateEnv", () => {
	it("accepts a minimal valid environment", () => {
		validBase();

		const env = validateEnv();

		expect(env.PORT).toBe(3000);
		expect(env.DOCS_ENABLED).toBe(true);
		expect(env.SESSION_MAX_CONCURRENT).toBe(10);
	});

	it("rejects an invalid port", () => {
		validBase();
		process.env.PORT = "not-a-port";

		expect(() => validateEnv()).toThrow("Invalid PORT configuration");
	});

	it("rejects a non-postgres database URL", () => {
		validBase();
		process.env.DATABASE_URL = "mysql://localhost/db";

		expect(() => validateEnv()).toThrow("Invalid DATABASE_URL configuration");
	});

	it("rejects a short cookie secret", () => {
		validBase();
		process.env.COOKIE_SECRET = "too-short";

		expect(() => validateEnv()).toThrow("Invalid COOKIE_SECRET configuration");
	});

	it("rejects an unknown log level", () => {
		validBase();
		process.env.LOG_LEVEL = "verbose";

		expect(() => validateEnv()).toThrow("Invalid LOG_LEVEL configuration");
	});

	it("defaults storage to the s3 provider without path-style addressing", () => {
		validBase();

		const env = validateEnv();

		expect(env.STORAGE_PROVIDER).toBe("s3");
		expect(env.S3_FORCE_PATH_STYLE).toBe(false);
	});

	it("accepts path-style addressing for self-hosted S3 implementations", () => {
		validBase();
		process.env.S3_FORCE_PATH_STYLE = "true";

		expect(validateEnv().S3_FORCE_PATH_STYLE).toBe(true);
	});

	it("rejects an unsupported storage provider", () => {
		validBase();
		process.env.STORAGE_PROVIDER = "gcs";

		expect(() => validateEnv()).toThrow('Invalid STORAGE_PROVIDER configuration');
	});
});

describe("validateEnv monitoring and alerts", () => {
	it("enables monitoring by default only in production", () => {
		validBase();

		expect(validateEnv().MONITOR_ENABLED).toBe(false);

		process.env.NODE_ENV = "production";

		expect(validateEnv().MONITOR_ENABLED).toBe(true);

		process.env.MONITOR_ENABLED = "false";

		expect(validateEnv().MONITOR_ENABLED).toBe(false);
	});

	it("applies the documented defaults", () => {
		validBase();

		const env = validateEnv();

		expect(env.MONITOR_PUBLIC_URL).toBeUndefined();
		expect(env.MONITOR_PUBLIC_STORAGE).toBe(false);
		expect(env.HEALTH_RETENTION_DAYS).toBe(30);
		expect(env.MONITOR_FAILURE_THRESHOLD).toBe(3);
		expect(env.MONITOR_RECOVERY_THRESHOLD).toBe(2);
		expect(env.MONITOR_INTERVAL_STORAGE_WRITE_SECONDS).toBe(3600);
		expect(env.MONITOR_TLS_DEGRADED_DAYS).toBe(14);
		expect(env.MONITOR_BACKUP_DOWN_HOURS).toBe(50);
		expect(env.RESEND_API_KEY).toBeUndefined();
		expect(env.ALERT_FALLBACK_RECIPIENTS).toEqual([]);
	});

	it("normalizes the public URL without a trailing slash", () => {
		validBase();
		process.env.MONITOR_PUBLIC_URL = "https://api.example.com/";

		expect(validateEnv().MONITOR_PUBLIC_URL).toBe("https://api.example.com");
	});

	it.each([
		"not a url",
		"ftp://api.example.com",
		"https://user:pass@api.example.com",
	])("rejects MONITOR_PUBLIC_URL %s", (value) => {
		validBase();
		process.env.MONITOR_PUBLIC_URL = value;

		expect(() => validateEnv()).toThrow("Invalid MONITOR_PUBLIC_URL configuration");
	});

	it("requires S3_PUBLIC_ENDPOINT when the public storage probe is enabled", () => {
		validBase();
		process.env.MONITOR_PUBLIC_STORAGE = "true";
		process.env.S3_PUBLIC_ENDPOINT = "";

		expect(() => validateEnv()).toThrow("Invalid MONITOR_PUBLIC_STORAGE configuration");

		process.env.S3_PUBLIC_ENDPOINT = "https://storage.example.com";

		expect(validateEnv().MONITOR_PUBLIC_STORAGE).toBe(true);
	});

	it("rejects non-positive intervals and thresholds", () => {
		validBase();
		process.env.MONITOR_INTERVAL_DATABASE_SECONDS = "0";

		expect(() => validateEnv()).toThrow("Invalid MONITOR_INTERVAL_DATABASE_SECONDS configuration");

		process.env.MONITOR_INTERVAL_DATABASE_SECONDS = "";
		process.env.MONITOR_FAILURE_THRESHOLD = "-1";

		expect(() => validateEnv()).toThrow("Invalid MONITOR_FAILURE_THRESHOLD configuration");
	});

	it("rejects inverted TLS and backup thresholds", () => {
		validBase();
		process.env.MONITOR_TLS_DOWN_DAYS = "20";

		expect(() => validateEnv()).toThrow("Invalid MONITOR_TLS_DOWN_DAYS configuration");

		process.env.MONITOR_TLS_DOWN_DAYS = "";
		process.env.MONITOR_BACKUP_DOWN_HOURS = "26";

		expect(() => validateEnv()).toThrow("Invalid MONITOR_BACKUP_DOWN_HOURS configuration");
	});

	it("normalizes and deduplicates fallback recipients", () => {
		validBase();
		process.env.ALERT_FALLBACK_RECIPIENTS = " Ops@Example.com, ops@example.com,admin@example.org ";

		expect(validateEnv().ALERT_FALLBACK_RECIPIENTS).toEqual(["ops@example.com", "admin@example.org"]);
	});

	it.each([
		"not-an-email",
		"a@example.com, b@",
		"a@example.com\r\nBcc: x@evil.com",
		"<a@example.com>",
	])("rejects fallback recipients %s", (value) => {
		validBase();
		process.env.ALERT_FALLBACK_RECIPIENTS = value;

		expect(() => validateEnv()).toThrow("Invalid ALERT_FALLBACK_RECIPIENTS configuration");
	});

	it.each([
		"alerts@example.com",
		"Nostos Alerts <alerts@example.com>",
	])("accepts sender %s", (value) => {
		validBase();
		process.env.ALERT_EMAIL_FROM = value;

		expect(validateEnv().ALERT_EMAIL_FROM).toBe(value);
	});

	it.each([
		"alerts",
		"Nostos <alerts>",
		"Evil\r\nBcc: x <alerts@example.com>",
	])("rejects sender %s", (value) => {
		validBase();
		process.env.ALERT_EMAIL_FROM = value;

		expect(() => validateEnv()).toThrow("Invalid ALERT_EMAIL_FROM configuration");
	});

	it("never includes the Resend API key in validation errors", () => {
		validBase();
		process.env.RESEND_API_KEY = "re_super_secret_value";
		process.env.ALERT_EMAIL_FROM = "broken";

		expect(() => validateEnv()).toThrow(/^(?!.*re_super_secret_value).*$/);
	});
});
