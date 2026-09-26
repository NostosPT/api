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
let adminCookie = "";
let photographerCookie = "";

beforeAll(async () => {
	app = await createApp();
});

beforeEach(async () => {
	resetMockIds();
	resetMock(holder.prisma);
	mock = holder.prisma;

	// Seeded sessions (not HTTP logins) keep the login rate-limit budget
	// untouched for the tests that exercise it indirectly.
	const admin = await seedUser(mock, { email: "admin@nostos.photos", password: "Correct Horse 12", role: "ADMIN" });
	const photographer = await seedUser(mock, { email: "photo@nostos.photos", password: "Correct Horse 12", role: "PHOTOGRAPHER" });
	adminCookie = sessionCookie(await seedSession(mock, admin.id));
	photographerCookie = sessionCookie(await seedSession(mock, photographer.id));
});

describe("users authorization", () => {
	it("rejects unauthenticated access", async () => {
		const response = await app.inject({ method: "GET", url: "/v1/users" });

		expect(response.statusCode).toBe(401);
	});

	it("rejects non-admin roles", async () => {
		const response = await app.inject({
			method: "GET",
			url: "/v1/users",
			headers: { cookie: photographerCookie },
		});

		expect(response.statusCode).toBe(403);
		expect(response.json().error.code).toBe("AUTHORIZATION_ERROR");
	});
});

describe("users management", () => {
	it("lists users with pagination and safe DTOs", async () => {
		const response = await app.inject({
			method: "GET",
			url: "/v1/users?page=1&pageSize=10",
			headers: { cookie: adminCookie },
		});
		const body = response.json();

		expect(response.statusCode).toBe(200);
		expect(body.total).toBe(2);
		expect(body.items).toHaveLength(2);
		expect(JSON.stringify(body)).not.toContain("passwordHash");
	});

	it("creates a user and rejects duplicates and invalid roles", async () => {
		const created = await app.inject({
			method: "POST",
			url: "/v1/users",
			headers: { cookie: adminCookie },
			payload: { email: "new@nostos.photos", name: "New", password: "Correct Horse 12", role: "EDITOR" },
		});
		const body = created.json();

		expect(created.statusCode).toBe(201);
		expect(body.email).toBe("new@nostos.photos");
		expect(JSON.stringify(body)).not.toContain("passwordHash");
		expect(auditActions(mock)).toContain("users.create");

		const duplicate = await app.inject({
			method: "POST",
			url: "/v1/users",
			headers: { cookie: adminCookie },
			payload: { email: "new@nostos.photos", name: "Dup", password: "Correct Horse 12", role: "EDITOR" },
		});

		expect(duplicate.statusCode).toBe(409);

		const badRole = await app.inject({
			method: "POST",
			url: "/v1/users",
			headers: { cookie: adminCookie },
			payload: { email: "x@nostos.photos", name: "X", password: "Correct Horse 12", role: "SUPERADMIN" },
		});

		expect(badRole.statusCode).toBe(400);
		expect(badRole.json().error.code).toBe("VALIDATION_ERROR");
	});

	it("updates users and guards self role changes", async () => {
		const me = await app.inject({
			method: "GET",
			url: "/v1/auth/me",
			headers: { cookie: adminCookie },
		});
		const adminId = me.json().id as string;

		const other = await app.inject({
			method: "POST",
			url: "/v1/users",
			headers: { cookie: adminCookie },
			payload: { email: "ed@nostos.photos", name: "Ed", password: "Correct Horse 12", role: "EDITOR" },
		});
		const otherId = other.json().id as string;

		const updated = await app.inject({
			method: "PATCH",
			url: `/v1/users/${otherId}`,
			headers: { cookie: adminCookie },
			payload: { name: "Eduardo" },
		});

		expect(updated.statusCode).toBe(200);
		expect(updated.json().name).toBe("Eduardo");

		const selfDemote = await app.inject({
			method: "PATCH",
			url: `/v1/users/${adminId}`,
			headers: { cookie: adminCookie },
			payload: { role: "ASSISTANT" },
		});

		expect(selfDemote.statusCode).toBe(409);
	});

	it("deactivates instead of deleting and revokes sessions", async () => {
		const created = await app.inject({
			method: "POST",
			url: "/v1/users",
			headers: { cookie: adminCookie },
			payload: { email: "gone@nostos.photos", name: "Gone", password: "Correct Horse 12", role: "EDITOR" },
		});
		const targetId = created.json().id as string;
		const targetCookie = await loginCookie(app, "gone@nostos.photos", "Correct Horse 12");

		const removed = await app.inject({
			method: "DELETE",
			url: `/v1/users/${targetId}`,
			headers: { cookie: adminCookie },
		});

		expect(removed.statusCode).toBe(200);
		expect(removed.json().status).toBe("SUSPENDED");

		const stillThere = await app.inject({
			method: "GET",
			url: `/v1/users/${targetId}`,
			headers: { cookie: adminCookie },
		});

		expect(stillThere.statusCode).toBe(200);

		const me = await app.inject({
			method: "GET",
			url: "/v1/auth/me",
			headers: { cookie: targetCookie },
		});

		expect(me.statusCode).toBe(401);
		expect(auditActions(mock)).toContain("users.delete");
	});

	it("refuses self-deletion (which would remove the last administrator)", async () => {
		const me = await app.inject({
			method: "GET",
			url: "/v1/auth/me",
			headers: { cookie: adminCookie },
		});
		const adminId = me.json().id as string;

		const photo = await app.inject({
			method: "GET",
			url: "/v1/auth/me",
			headers: { cookie: photographerCookie },
		});
		const photoId = photo.json().id as string;

		// Demoting another user is allowed; deleting yourself is refused.
		const demoteOther = await app.inject({
			method: "PATCH",
			url: `/v1/users/${photoId}`,
			headers: { cookie: adminCookie },
			payload: { role: "ASSISTANT" },
		});

		expect(demoteOther.statusCode).toBe(200);

		const removeLast = await app.inject({
			method: "DELETE",
			url: `/v1/users/${adminId}`,
			headers: { cookie: adminCookie },
		});

		expect(removeLast.statusCode).toBe(409);
	});

	it("returns 404 for unknown users and 400 for malformed ids", async () => {
		const missing = await app.inject({
			method: "GET",
			url: "/v1/users/00000000-0000-0000-0000-000000000000",
			headers: { cookie: adminCookie },
		});

		expect(missing.statusCode).toBe(404);

		const malformed = await app.inject({
			method: "GET",
			url: "/v1/users/not-a-uuid",
			headers: { cookie: adminCookie },
		});

		expect(malformed.statusCode).toBe(400);
		expect(malformed.json().error.code).toBe("VALIDATION_ERROR");
	});

	it("rejects unauthenticated photographer cookie use", async () => {
		const response = await app.inject({
			method: "GET",
			url: "/v1/users",
			headers: { cookie: sessionCookie("deadbeef") },
		});

		expect(response.statusCode).toBe(401);
	});
});




