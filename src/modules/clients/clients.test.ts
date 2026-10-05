import "../../test/env.js";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { createMockPrisma, resetMock, resetMockIds, simulateLatency, type MockPrisma } from "../../test/prisma-mock.js";

const holder = { prisma: createMockPrisma() };

vi.mock("../../db/prisma.js", () => ({ prisma: holder.prisma }));

import { createApp } from "../../app.js";
import { auditActions, seedSession, seedUser, sessionCookie } from "../../test/helpers.js";

vi.setConfig({ testTimeout: 30_000 });

const year = new Date().getFullYear();

let app: FastifyInstance;
let mock: MockPrisma;
let adminId = "";
let adminCookie = "";
let assistantCookie = "";
let photographerCookie = "";
let accountantCookie = "";
let editorCookie = "";

beforeAll(async () => {
	app = await createApp();
});

beforeEach(async () => {
	resetMockIds();
	resetMock(holder.prisma);
	mock = holder.prisma;

	const admin = await seedUser(mock, { email: "admin@nostos.photos", role: "ADMIN" });
	const assistant = await seedUser(mock, { email: "assistant@nostos.photos", role: "ASSISTANT" });
	const photographer = await seedUser(mock, { email: "photo@nostos.photos", role: "PHOTOGRAPHER" });
	const accountant = await seedUser(mock, { email: "money@nostos.photos", role: "ACCOUNTANT" });
	const editor = await seedUser(mock, { email: "editor@nostos.photos", role: "EDITOR" });

	adminId = admin.id;
	adminCookie = sessionCookie(await seedSession(mock, admin.id));
	assistantCookie = sessionCookie(await seedSession(mock, assistant.id));
	photographerCookie = sessionCookie(await seedSession(mock, photographer.id));
	accountantCookie = sessionCookie(await seedSession(mock, accountant.id));
	editorCookie = sessionCookie(await seedSession(mock, editor.id));
});

describe("client creation", () => {
	it("assigns sequential client codes, normalizes emails and validates the NIF", async () => {
		const first = await app.inject({
			method: "POST",
			url: "/v1/clients",
			headers: { cookie: adminCookie },
			payload: { name: "Ana Silva", email: "Ana@Example.COM" },
		});
		const firstBody = first.json();

		expect(first.statusCode).toBe(201);
		expect(firstBody.clientCode).toBe(`CLI-${year}-001`);
		expect(firstBody.email).toBe("ana@example.com");
		expect(firstBody.status).toBe("LEAD");
		expect(firstBody.deletedAt).toBeNull();

		const second = await app.inject({
			method: "POST",
			url: "/v1/clients",
			headers: { cookie: adminCookie },
			payload: { name: "Bruno Costa", email: "bruno@nostos.photos", status: "ACTIVE" },
		});

		expect(second.statusCode).toBe(201);
		expect(second.json().clientCode).toBe(`CLI-${year}-002`);
		expect(second.json().status).toBe("ACTIVE");

		const duplicate = await app.inject({
			method: "POST",
			url: "/v1/clients",
			headers: { cookie: adminCookie },
			payload: { name: "Ana Again", email: "ANA@example.com" },
		});

		expect(duplicate.statusCode).toBe(409);

		const badNif = await app.inject({
			method: "POST",
			url: "/v1/clients",
			headers: { cookie: adminCookie },
			payload: { name: "Invalid", email: "invalid@nostos.photos", taxId: "123" },
		});

		expect(badNif.statusCode).toBe(400);
	});
});

describe("client list", () => {
	it("searches by name and filters by status", async () => {
		await app.inject({
			method: "POST",
			url: "/v1/clients",
			headers: { cookie: adminCookie },
			payload: { name: "Ana Silva", email: "ana@nostos.photos" },
		});
		await app.inject({
			method: "POST",
			url: "/v1/clients",
			headers: { cookie: adminCookie },
			payload: { name: "Bruno Costa", email: "bruno@nostos.photos", status: "ACTIVE" },
		});

		const all = await app.inject({
			method: "GET",
			url: "/v1/clients",
			headers: { cookie: adminCookie },
		});

		expect(all.statusCode).toBe(200);
		expect(all.json().total).toBe(2);

		const search = await app.inject({
			method: "GET",
			url: "/v1/clients?q=bruno",
			headers: { cookie: adminCookie },
		});

		expect(search.statusCode).toBe(200);
		expect(search.json().total).toBe(1);
		expect(search.json().items[0].name).toBe("Bruno Costa");

		const leads = await app.inject({
			method: "GET",
			url: "/v1/clients?status=LEAD",
			headers: { cookie: adminCookie },
		});

		expect(leads.statusCode).toBe(200);
		expect(leads.json().total).toBe(1);
		expect(leads.json().items[0].name).toBe("Ana Silva");

		const missing = await app.inject({
			method: "GET",
			url: "/v1/clients/00000000-0000-4000-8000-000000000000",
			headers: { cookie: adminCookie },
		});

		expect(missing.statusCode).toBe(404);
	});
});

describe("client update and timeline", () => {
	it("updates a client, records the audit entry and lists timeline activity", async () => {
		const created = await app.inject({
			method: "POST",
			url: "/v1/clients",
			headers: { cookie: adminCookie },
			payload: { name: "Ana Silva", email: "ana@nostos.photos" },
		});
		const clientId = created.json().id as string;

		const updated = await app.inject({
			method: "PATCH",
			url: `/v1/clients/${clientId}`,
			headers: { cookie: adminCookie },
			payload: { status: "ACTIVE", notes: "Prefers email" },
		});

		expect(updated.statusCode).toBe(200);
		expect(updated.json().status).toBe("ACTIVE");
		expect(updated.json().notes).toBe("Prefers email");
		expect(auditActions(mock)).toContain("clients.update");

		mock.clientActivity.create({
			data: {
				clientId,
				kind: "NOTE",
				title: "Kickoff call",
				body: "Discussed dates",
				href: null,
				authorId: adminId,
			},
		});

		const activity = await app.inject({
			method: "GET",
			url: `/v1/clients/${clientId}/activity`,
			headers: { cookie: photographerCookie },
		});
		const activityBody = activity.json();

		expect(activity.statusCode).toBe(200);
		expect(activityBody.total).toBe(1);
		expect(activityBody.items[0].kind).toBe("NOTE");
		expect(activityBody.items[0].title).toBe("Kickoff call");
		expect(activityBody.items[0].clientId).toBe(clientId);
	});
});

describe("client archival", () => {
	it("archives instead of deleting and hides the client from the default list", async () => {
		const created = await app.inject({
			method: "POST",
			url: "/v1/clients",
			headers: { cookie: adminCookie },
			payload: { name: "Ana Silva", email: "ana@nostos.photos" },
		});
		const clientId = created.json().id as string;

		const archived = await app.inject({
			method: "DELETE",
			url: `/v1/clients/${clientId}`,
			headers: { cookie: assistantCookie },
		});
		const archivedBody = archived.json();

		expect(archived.statusCode).toBe(200);
		expect(archivedBody.deletedAt).not.toBeNull();
		expect(archivedBody.email).toBe(`deleted_${clientId}@archived.invalid`);
		expect(auditActions(mock)).toContain("clients.delete");

		const activeList = await app.inject({
			method: "GET",
			url: "/v1/clients",
			headers: { cookie: adminCookie },
		});

		expect(activeList.json().total).toBe(0);

		const archivedList = await app.inject({
			method: "GET",
			url: "/v1/clients?archived=true",
			headers: { cookie: adminCookie },
		});

		expect(archivedList.statusCode).toBe(200);
		expect(archivedList.json().total).toBe(1);
		expect(archivedList.json().items[0].id).toBe(clientId);

		const repeated = await app.inject({
			method: "DELETE",
			url: `/v1/clients/${clientId}`,
			headers: { cookie: assistantCookie },
		});

		expect(repeated.statusCode).toBe(409);

		const updateArchived = await app.inject({
			method: "PATCH",
			url: `/v1/clients/${clientId}`,
			headers: { cookie: adminCookie },
			payload: { name: "Renamed" },
		});

		expect(updateArchived.statusCode).toBe(409);
	});
});

describe("client permission matrix", () => {
	it("requires a session, denies EDITOR and restricts writes to ADMIN and ASSISTANT", async () => {
		const created = await app.inject({
			method: "POST",
			url: "/v1/clients",
			headers: { cookie: adminCookie },
			payload: { name: "Ana Silva", email: "ana@nostos.photos" },
		});
		const clientId = created.json().id as string;

		const anonymous = await app.inject({ method: "GET", url: "/v1/clients" });

		expect(anonymous.statusCode).toBe(401);

		const editorRead = await app.inject({
			method: "GET",
			url: "/v1/clients",
			headers: { cookie: editorCookie },
		});

		expect(editorRead.statusCode).toBe(403);
		expect(editorRead.json().error.code).toBe("AUTHORIZATION_ERROR");

		const photographerRead = await app.inject({
			method: "GET",
			url: "/v1/clients",
			headers: { cookie: photographerCookie },
		});

		expect(photographerRead.statusCode).toBe(200);

		const photographerWrite = await app.inject({
			method: "POST",
			url: "/v1/clients",
			headers: { cookie: photographerCookie },
			payload: { name: "Nope", email: "nope@nostos.photos" },
		});

		expect(photographerWrite.statusCode).toBe(403);

		const accountantRead = await app.inject({
			method: "GET",
			url: `/v1/clients/${clientId}`,
			headers: { cookie: accountantCookie },
		});

		expect(accountantRead.statusCode).toBe(200);

		const accountantDelete = await app.inject({
			method: "DELETE",
			url: `/v1/clients/${clientId}`,
			headers: { cookie: accountantCookie },
		});

		expect(accountantDelete.statusCode).toBe(403);

		const assistantCreate = await app.inject({
			method: "POST",
			url: "/v1/clients",
			headers: { cookie: assistantCookie },
			payload: { name: "Assistant Client", email: "ac@nostos.photos" },
		});

		expect(assistantCreate.statusCode).toBe(201);
	});
});

describe("client code generation", () => {
	async function create(name: string, email: string) {
		return app.inject({
			method: "POST",
			url: "/v1/clients",
			headers: { cookie: adminCookie },
			payload: { name, email },
		});
	}

	it("keeps counting numerically past 999 instead of sorting codes as text", async () => {
		// CLI-…-1000 sorts before CLI-…-999 as text; the counter must not care.
		for (const code of [`CLI-${year}-998`, `CLI-${year}-999`, `CLI-${year}-1000`]) {
			mock.client.create({ data: { clientCode: code, email: `${code.toLowerCase()}@nostos.photos`, name: code, status: "LEAD" } });
		}
		mock.codeCounter.create({ data: { scope: "CLIENT", year, value: 1000 } });

		const first = await create("Ana Silva", "ana@nostos.photos");
		const second = await create("Bruno Costa", "bruno@nostos.photos");

		expect(first.statusCode).toBe(201);
		expect(second.statusCode).toBe(201);
		expect(first.json().clientCode).toBe(`CLI-${year}-1001`);
		expect(second.json().clientCode).toBe(`CLI-${year}-1002`);
	});

	it("gives every concurrent creation its own code", async () => {
		const count = 25;
		const restore = simulateLatency(mock);
		const responses = await Promise.all(
			Array.from({ length: count }, (_, index) => create(`Client ${index}`, `client-${index}@nostos.photos`)),
		).finally(restore);

		expect(responses.map((response) => response.statusCode)).toEqual(Array(count).fill(201));

		const codes = responses.map((response) => response.json().clientCode as string).sort();

		expect(codes).toEqual(
			Array.from({ length: count }, (_, index) => `CLI-${year}-${String(index + 1).padStart(3, "0")}`),
		);
	});
});
