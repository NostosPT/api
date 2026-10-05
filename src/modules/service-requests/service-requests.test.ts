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

	adminId = admin.id;
	adminCookie = sessionCookie(await seedSession(mock, admin.id));
	assistantCookie = sessionCookie(await seedSession(mock, assistant.id));
	photographerCookie = sessionCookie(await seedSession(mock, photographer.id));
	accountantCookie = sessionCookie(await seedSession(mock, accountant.id));

	mock.service.create({
		data: {
			slug: "wedding-photography",
			name: "Wedding Photography",
			description: null,
			priceFromCents: 120000,
			priceToCents: null,
			currency: "EUR",
			active: true,
			position: 1,
			createdAt: new Date(),
			updatedAt: new Date(),
		},
	});
});

describe("public service catalogue", () => {
	it("lists and resolves services without authentication", async () => {
		const list = await app.inject({ method: "GET", url: "/v1/services" });
		const listBody = list.json();

		expect(list.statusCode).toBe(200);
		expect(listBody.items).toHaveLength(1);
		expect(listBody.items[0].slug).toBe("wedding-photography");
		expect(listBody.items[0].priceFromCents).toBe(120000);

		const detail = await app.inject({ method: "GET", url: "/v1/services/wedding-photography" });

		expect(detail.statusCode).toBe(200);
		expect(detail.json().name).toBe("Wedding Photography");

		const missing = await app.inject({ method: "GET", url: "/v1/services/not-a-service" });

		expect(missing.statusCode).toBe(404);
	});
});

describe("public service request intake", () => {
	it("creates a request with generated reference and a new client", async () => {
		const response = await app.inject({
			method: "POST",
			url: "/v1/service-requests",
			payload: {
				service: "wedding-photography",
				budgetMin: 1000,
				contact: { name: "Ana Silva", email: "Ana@Example.COM" },
			},
		});
		const body = response.json();

		expect(response.statusCode).toBe(201);
		expect(body.reference).toBe(`REQ-${year}-001`);
		expect(body.stage).toBe("NEW");
		expect(body.source).toBe("WEBSITE");
		expect(body.budgetMinCents).toBe(100000);
		expect(body.assigneeId).toBeNull();
		expect(body.clientId).toBeTruthy();
		expect(mock.client.rows).toHaveLength(1);
		expect(mock.client.rows[0].email).toBe("ana@example.com");
		expect(mock.serviceRequest.rows).toHaveLength(1);

		const unknownService = await app.inject({
			method: "POST",
			url: "/v1/service-requests",
			payload: { service: "not-a-service", contact: { email: "x@example.com" } },
		});

		expect(unknownService.statusCode).toBe(404);
	});

	it("reuses the existing client for a repeat submission from the same email", async () => {
		const first = await app.inject({
			method: "POST",
			url: "/v1/service-requests",
			payload: { service: "wedding-photography", contact: { name: "Ana", email: "repeat@nostos.photos" } },
		});
		const second = await app.inject({
			method: "POST",
			url: "/v1/service-requests",
			payload: { service: "wedding-photography", contact: { name: "Ana Again", email: "REPEAT@nostos.photos" } },
		});

		expect(first.statusCode).toBe(201);
		expect(second.statusCode).toBe(201);
		expect(second.json().clientId).toBe(first.json().clientId);
		expect(first.json().reference).toBe(`REQ-${year}-001`);
		expect(second.json().reference).toBe(`REQ-${year}-002`);
		expect(mock.client.rows).toHaveLength(1);
	});
});

describe("staff request management", () => {
	it("lists, updates and annotates requests with audit records", async () => {
		const created = await app.inject({
			method: "POST",
			url: "/v1/service-requests",
			payload: { service: "wedding-photography", contact: { name: "Bo", email: "bo@nostos.photos" } },
		});
		const requestId = created.json().id as string;

		const list = await app.inject({
			method: "GET",
			url: "/v1/service-requests?page=1&pageSize=10",
			headers: { cookie: adminCookie },
		});

		expect(list.statusCode).toBe(200);
		expect(list.json().total).toBe(1);
		expect(list.json().items[0].reference).toBe(`REQ-${year}-001`);

		const updated = await app.inject({
			method: "PATCH",
			url: `/v1/service-requests/${requestId}`,
			headers: { cookie: adminCookie },
			payload: { stage: "QUALIFIED", assigneeId: adminId },
		});

		expect(updated.statusCode).toBe(200);
		expect(updated.json().stage).toBe("QUALIFIED");
		expect(updated.json().assigneeId).toBe(adminId);
		expect(auditActions(mock)).toContain("requests.update");

		const note = await app.inject({
			method: "POST",
			url: `/v1/service-requests/${requestId}/notes`,
			headers: { cookie: assistantCookie },
			payload: { body: "Called the client" },
		});

		expect(note.statusCode).toBe(201);
		expect(note.json().body).toBe("Called the client");

		const notes = await app.inject({
			method: "GET",
			url: `/v1/service-requests/${requestId}/notes`,
			headers: { cookie: photographerCookie },
		});

		expect(notes.statusCode).toBe(200);
		expect(notes.json().items).toHaveLength(1);
		expect(auditActions(mock)).toContain("requests.note");
	});

	it("requires a session for reads and limits writes to ADMIN and ASSISTANT", async () => {
		const created = await app.inject({
			method: "POST",
			url: "/v1/service-requests",
			payload: { service: "wedding-photography", contact: { email: "auth@nostos.photos" } },
		});
		const requestId = created.json().id as string;

		const anonymous = await app.inject({ method: "GET", url: "/v1/service-requests" });

		expect(anonymous.statusCode).toBe(401);

		const accountantRead = await app.inject({
			method: "GET",
			url: "/v1/service-requests",
			headers: { cookie: accountantCookie },
		});

		expect(accountantRead.statusCode).toBe(200);

		const photographerWrite = await app.inject({
			method: "PATCH",
			url: `/v1/service-requests/${requestId}`,
			headers: { cookie: photographerCookie },
			payload: { stage: "QUALIFIED" },
		});

		expect(photographerWrite.statusCode).toBe(403);
		expect(photographerWrite.json().error.code).toBe("AUTHORIZATION_ERROR");

		const accountantWrite = await app.inject({
			method: "POST",
			url: `/v1/service-requests/${requestId}/notes`,
			headers: { cookie: accountantCookie },
			payload: { body: "not allowed" },
		});

		expect(accountantWrite.statusCode).toBe(403);
	});
});

describe("reference generation", () => {
	function seedRequest(reference: string): void {
		const client = mock.client.rows[0] ?? mock.client.create({
			data: { clientCode: `CLI-${year}-900`, email: "seed@nostos.photos", name: "Seed", status: "LEAD" },
		});

		mock.serviceRequest.create({
			data: { reference, title: "Seed", clientId: client.id, stage: "NEW", locationUndecided: false },
		});
	}

	async function submit(email: string) {
		return app.inject({
			method: "POST",
			url: "/v1/service-requests",
			payload: { service: "wedding-photography", contact: { name: "Ana", email } },
		});
	}

	it("keeps counting numerically past 999 instead of sorting references as text", async () => {
		// REQ-…-1000 sorts before REQ-…-999 as text; the counter must not care.
		seedRequest(`REQ-${year}-998`);
		seedRequest(`REQ-${year}-999`);
		seedRequest(`REQ-${year}-1000`);
		mock.codeCounter.create({ data: { scope: "SERVICE_REQUEST", year, value: 1000 } });

		const first = await submit("first@nostos.photos");
		const second = await submit("second@nostos.photos");

		expect(first.statusCode).toBe(201);
		expect(second.statusCode).toBe(201);
		expect(first.json().reference).toBe(`REQ-${year}-1001`);
		expect(second.json().reference).toBe(`REQ-${year}-1002`);
	});

	it("skips numbers already taken by rows the counter has not seen", async () => {
		seedRequest(`REQ-${year}-001`);
		seedRequest(`REQ-${year}-002`);

		const response = await submit("late@nostos.photos");

		expect(response.statusCode).toBe(201);
		expect(response.json().reference).toBe(`REQ-${year}-003`);
		expect(mock.codeCounter.rows.find((row) => row.scope === "SERVICE_REQUEST")?.value).toBe(3);
	});

	it("gives every concurrent submission its own reference and client code", async () => {
		const count = 25;
		const restore = simulateLatency(mock);
		const responses = await Promise.all(
			Array.from({ length: count }, (_, index) => submit(`concurrent-${index}@nostos.photos`)),
		).finally(restore);

		expect(responses.map((response) => response.statusCode)).toEqual(Array(count).fill(201));

		const expected = Array.from({ length: count }, (_, index) => String(index + 1).padStart(3, "0"));
		const references = responses.map((response) => response.json().reference as string).sort();
		const clientCodes = mock.client.rows.map((row) => row.clientCode as string).sort();

		expect(references).toEqual(expected.map((number) => `REQ-${year}-${number}`));
		expect(clientCodes).toEqual(expected.map((number) => `CLI-${year}-${number}`));
	});
});
