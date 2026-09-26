import "../../test/env.js";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { createMockPrisma, resetMock, resetMockIds, type MockPrisma } from "../../test/prisma-mock.js";

const holder = { prisma: createMockPrisma() };

vi.mock("../../db/prisma.js", () => ({ prisma: holder.prisma }));

import { createApp } from "../../app.js";
import { auditActions, loginCookie, seedSession, seedUser, sessionCookie } from "../../test/helpers.js";

vi.setConfig({ testTimeout: 30_000 });

let app: FastifyInstance;
let mock: MockPrisma;

beforeAll(async () => {
	app = await createApp();
});

beforeEach(() => {
	resetMockIds();
	resetMock(holder.prisma);
	mock = holder.prisma;
});

describe("auth", () => {
	it("logs in with valid credentials and sets the session cookie", async () => {
		await seedUser(mock, { email: "marta@nostos.photos", password: "Correct Horse 12" });

		const response = await app.inject({
			method: "POST",
			url: "/v1/auth/login",
			payload: { email: "marta@nostos.photos", password: "Correct Horse 12" },
		});
		const body = response.json();

		expect(response.statusCode).toBe(200);
		expect(body.email).toBe("marta@nostos.photos");
		expect(body.role).toBe("ADMIN");
		expect(JSON.stringify(body)).not.toContain("passwordHash");
		expect(JSON.stringify(body)).not.toContain("tokenHash");

		const setCookie = String(response.headers["set-cookie"] ?? "");
		expect(setCookie).toContain("__Host-nostos.sid=");
		expect(setCookie).toContain("HttpOnly");
		expect(setCookie).toContain("Path=/");
		expect(setCookie).toContain("SameSite=Lax");
		expect(auditActions(mock)).toContain("auth.login.success");
	});

	it("rejects invalid credentials with a generic response", async () => {
		await seedUser(mock, { email: "marta@nostos.photos", password: "Correct Horse 12" });

		for (const payload of [
			{ email: "marta@nostos.photos", password: "Wrong Password 99" },
			{ email: "nobody@nostos.photos", password: "Correct Horse 12" },
		]) {
			const response = await app.inject({ method: "POST", url: "/v1/auth/login", payload });
			const body = response.json();

			expect(response.statusCode).toBe(401);
			expect(body.error.code).toBe("AUTHENTICATION_ERROR");
			expect(body.error.message).toBe("Invalid email or password");
		}

		expect(auditActions(mock).filter((action) => action === "auth.login.failure")).toHaveLength(2);
	});

	it("rejects suspended users with the same generic response", async () => {
		await seedUser(mock, { email: "marta@nostos.photos", password: "Correct Horse 12", status: "SUSPENDED" });

		const response = await app.inject({
			method: "POST",
			url: "/v1/auth/login",
			payload: { email: "marta@nostos.photos", password: "Correct Horse 12" },
		});

		expect(response.statusCode).toBe(401);
		expect(response.json().error.message).toBe("Invalid email or password");
	});

	it("returns 401 from /auth/me without a session", async () => {
		const response = await app.inject({ method: "GET", url: "/v1/auth/me" });

		expect(response.statusCode).toBe(401);
		expect(response.json().error.code).toBe("AUTHENTICATION_ERROR");
	});

	it("returns the current user with a valid session", async () => {
		const { id } = await seedUser(mock, { email: "marta@nostos.photos" });
		const token = await seedSession(mock, id);

		const response = await app.inject({
			method: "GET",
			url: "/v1/auth/me",
			headers: { cookie: sessionCookie(token) },
		});
		const body = response.json();

		expect(response.statusCode).toBe(200);
		expect(body.email).toBe("marta@nostos.photos");
		expect(JSON.stringify(body)).not.toContain("passwordHash");
	});

	it("stops authorizing sessions of suspended users", async () => {
		const { id } = await seedUser(mock, { email: "marta@nostos.photos", status: "SUSPENDED" });
		const token = await seedSession(mock, id);

		const response = await app.inject({
			method: "GET",
			url: "/v1/auth/me",
			headers: { cookie: sessionCookie(token) },
		});

		expect(response.statusCode).toBe(401);
	});

	it("logs out by revoking the current session and clearing the cookie", async () => {
		await seedUser(mock, { email: "marta@nostos.photos", password: "Correct Horse 12" });
		const cookie = await loginCookie(app, "marta@nostos.photos", "Correct Horse 12");

		const logout = await app.inject({
			method: "POST",
			url: "/v1/auth/logout",
			headers: { cookie },
		});

		expect(logout.statusCode).toBe(200);
		expect(logout.json()).toEqual({ status: "ok" });
		expect(String(logout.headers["set-cookie"] ?? "")).toContain("__Host-nostos.sid=;");
		expect(auditActions(mock)).toContain("auth.logout");

		const me = await app.inject({ method: "GET", url: "/v1/auth/me", headers: { cookie } });

		expect(me.statusCode).toBe(401);
	});

	it("logs out everywhere by revoking all user sessions", async () => {
		const { id } = await seedUser(mock, { email: "marta@nostos.photos", password: "Correct Horse 12" });
		const first = await seedSession(mock, id);
		const second = await seedSession(mock, id);
		const cookie = await loginCookie(app, "marta@nostos.photos", "Correct Horse 12");

		const response = await app.inject({
			method: "POST",
			url: "/v1/auth/logout-all",
			headers: { cookie },
		});

		expect(response.statusCode).toBe(200);
		expect(response.json().revokedSessions).toBe(3);
		expect(auditActions(mock)).toContain("auth.logout_all");

		for (const token of [first, second]) {
			const me = await app.inject({
				method: "GET",
				url: "/v1/auth/me",
				headers: { cookie: sessionCookie(token) },
			});

			expect(me.statusCode).toBe(401);
		}
	});
});





