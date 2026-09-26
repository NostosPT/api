import "../test/env.js";
import { describe, expect, it } from "vitest";
import {
	hashSessionToken,
	sessionCookieAttributes,
	SESSION_COOKIE_NAME,
	verifySessionToken,
	generateSessionToken,
} from "./session.js";

describe("session tokens", () => {
	it("generates 256-bit hex tokens", () => {
		const first = generateSessionToken();
		const second = generateSessionToken();

		expect(first).toMatch(/^[0-9a-f]{64}$/);
		expect(second).toMatch(/^[0-9a-f]{64}$/);
		expect(first).not.toBe(second);
	});

	it("hashes deterministically to a 128-char SHA-512 hex digest", () => {
		const token = generateSessionToken();

		expect(hashSessionToken(token)).toMatch(/^[0-9a-f]{128}$/);
		expect(hashSessionToken(token)).toBe(hashSessionToken(token));
	});

	it("verifies matching tokens and rejects others", () => {
		const token = generateSessionToken();
		const stored = hashSessionToken(token);

		expect(verifySessionToken(token, stored)).toBe(true);
		expect(verifySessionToken(generateSessionToken(), stored)).toBe(false);
		expect(verifySessionToken(token, "short")).toBe(false);
	});
});

describe("session cookie", () => {
	it("uses the API-host scoped name", () => {
		expect(SESSION_COOKIE_NAME.startsWith("__Host-")).toBe(true);
	});

	it("sets secure in production and not in development", () => {
		const production = sessionCookieAttributes(true, 1000);
		const development = sessionCookieAttributes(false, 1000);

		expect(production).toMatchObject({
			httpOnly: true,
			secure: true,
			sameSite: "lax",
			path: "/",
			maxAgeSeconds: 1000,
		});
		expect(development.secure).toBe(false);
		expect(development.httpOnly).toBe(true);
	});
});
