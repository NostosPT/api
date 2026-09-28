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
