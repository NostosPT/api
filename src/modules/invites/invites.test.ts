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

beforeAll(async () => {
	app = await createApp();
});

beforeEach(async () => {
	resetMockIds();
	resetMock(holder.prisma);
	mock = holder.prisma;

	const admin = await seedUser(mock, { email: "admin@nostos.photos", password: "Correct Horse 12", role: "ADMIN" });
	adminCookie = sessionCookie(await seedSession(mock, admin.id));
});

describe("invites", () => {
	it("creates an invite returning the token once, and hides it from listing", async () => {
		const created = await app.inject({
			method: "POST",
			url: "/v1/invites",
			headers: { cookie: adminCookie },
			payload: { email: "Editor@nostos.photos", role: "EDITOR" },
		});
		const body = created.json();

		expect(created.statusCode).toBe(201);
		expect(body.email).toBe("editor@nostos.photos");
		expect(typeof body.token).toBe("string");
		expect(body.token).toHaveLength(64);
		expect(auditActions(mock)).toContain("invites.create");

		const listed = await app.inject({
			method: "GET",
			url: "/v1/invites",
			headers: { cookie: adminCookie },
		});
		const listBody = listed.json();

		expect(listed.statusCode).toBe(200);
		expect(listBody.total).toBe(1);
		expect(listBody.items[0].status).toBe("PENDING");
		expect(JSON.stringify(listBody)).not.toContain(body.token);
	});

	it("rejects duplicate pending invites and registered emails", async () => {
		await app.inject({
			method: "POST",
			url: "/v1/invites",
			headers: { cookie: adminCookie },
			payload: { email: "ed@nostos.photos", role: "EDITOR" },
		});

		const duplicate = await app.inject({
			method: "POST",
			url: "/v1/invites",
			headers: { cookie: adminCookie },
			payload: { email: "ed@nostos.photos", role: "EDITOR" },
		});

		expect(duplicate.statusCode).toBe(409);

		const registered = await app.inject({
			method: "POST",
			url: "/v1/invites",
			headers: { cookie: adminCookie },
			payload: { email: "admin@nostos.photos", role: "EDITOR" },
		});

		expect(registered.statusCode).toBe(409);
	});

	it("deletes invites and 404s unknown ids", async () => {
		const created = await app.inject({
			method: "POST",
			url: "/v1/invites",
			headers: { cookie: adminCookie },
			payload: { email: "temp@nostos.photos", role: "ASSISTANT" },
		});
		const id = created.json().id as string;

		const removed = await app.inject({
			method: "DELETE",
			url: `/v1/invites/${id}`,
			headers: { cookie: adminCookie },
		});

		expect(removed.statusCode).toBe(204);
		expect(auditActions(mock)).toContain("invites.delete");

		const missing = await app.inject({
			method: "DELETE",
			url: "/v1/invites/00000000-0000-0000-0000-000000000000",
			headers: { cookie: adminCookie },
		});

		expect(missing.statusCode).toBe(404);
	});

	it("accepts a valid invite, then logs in with the new account", async () => {
		const created = await app.inject({
			method: "POST",
			url: "/v1/invites",
			headers: { cookie: adminCookie },
			payload: { email: "new@nostos.photos", role: "PHOTOGRAPHER" },
		});
		const token = created.json().token as string;

		const accepted = await app.inject({
			method: "POST",
			url: "/v1/auth/accept-invite",
			payload: { token, name: "New Hire", password: "Correct Horse 12" },
		});
		const body = accepted.json();

		expect(accepted.statusCode).toBe(200);
		expect(body.email).toBe("new@nostos.photos");
		expect(body.role).toBe("PHOTOGRAPHER");
		expect(JSON.stringify(body)).not.toContain("passwordHash");
		expect(auditActions(mock)).toContain("invites.accept");

		const login = await app.inject({
			method: "POST",
			url: "/v1/auth/login",
			payload: { email: "new@nostos.photos", password: "Correct Horse 12" },
		});

		expect(login.statusCode).toBe(200);

		const reuse = await app.inject({
			method: "POST",
			url: "/v1/auth/accept-invite",
			payload: { token, name: "Again", password: "Correct Horse 12" },
		});

		expect(reuse.statusCode).toBe(404);
	});

	it("rejects unknown and expired invite tokens", async () => {
		const { generateSessionToken, hashSessionToken } = await import("../../auth/session.js");

		const unknown = await app.inject({
			method: "POST",
			url: "/v1/auth/accept-invite",
			payload: { token: generateSessionToken(), name: "X", password: "Correct Horse 12" },
		});

		expect(unknown.statusCode).toBe(404);

		const token = generateSessionToken();

		mock.invite.create({
			data: {
				id: "inv_expired",
				email: "old@nostos.photos",
				role: "EDITOR",
				tokenHash: hashSessionToken(token),
				invitedById: "user_test_admin@nostos.photos",
				expiresAt: new Date(Date.now() - 1000),
				acceptedAt: null,
				createdAt: new Date(),
			},
		});

		const expired = await app.inject({
			method: "POST",
			url: "/v1/auth/accept-invite",
			payload: { token, name: "X", password: "Correct Horse 12" },
		});

		expect(expired.statusCode).toBe(404);
	});

	it("rejects non-admin invite access", async () => {
		await seedUser(mock, { email: "photo@nostos.photos", password: "Correct Horse 12", role: "PHOTOGRAPHER" });
		const cookie = await loginCookie(app, "photo@nostos.photos", "Correct Horse 12");

		const response = await app.inject({
			method: "GET",
			url: "/v1/invites",
			headers: { cookie },
		});

		expect(response.statusCode).toBe(403);
	});
});




