import "../../test/env.js";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { createMockPrisma, resetMock, resetMockIds, type MockPrisma } from "../../test/prisma-mock.js";

const holder = { prisma: createMockPrisma() };

vi.mock("../../db/prisma.js", () => ({ prisma: holder.prisma }));

import { createApp } from "../../app.js";
import { auditActions, seedSession, seedUser, sessionCookie } from "../../test/helpers.js";

vi.setConfig({ testTimeout: 30_000 });

let app: FastifyInstance;
let mock: MockPrisma;
let adminCookie = "";
let photographerCookie = "";
let editorCookie = "";
let assistantCookie = "";
let accountantCookie = "";

beforeAll(async () => {
	app = await createApp();
});

beforeEach(async () => {
	resetMockIds();
	resetMock(holder.prisma);
	mock = holder.prisma;

	const admin = await seedUser(mock, { email: "admin@nostos.photos", role: "ADMIN" });
	const photographer = await seedUser(mock, { email: "photo@nostos.photos", role: "PHOTOGRAPHER" });
	const editor = await seedUser(mock, { email: "editor@nostos.photos", role: "EDITOR" });
	const assistant = await seedUser(mock, { email: "assistant@nostos.photos", role: "ASSISTANT" });
	const accountant = await seedUser(mock, { email: "money@nostos.photos", role: "ACCOUNTANT" });

	adminCookie = sessionCookie(await seedSession(mock, admin.id));
	photographerCookie = sessionCookie(await seedSession(mock, photographer.id));
	editorCookie = sessionCookie(await seedSession(mock, editor.id));
	assistantCookie = sessionCookie(await seedSession(mock, assistant.id));
	accountantCookie = sessionCookie(await seedSession(mock, accountant.id));
});

describe("tag management", () => {
	it("creates tags with defaults and rejects duplicates and invalid slugs", async () => {
		const created = await app.inject({
			method: "POST",
			url: "/v1/tags",
			headers: { cookie: adminCookie },
			payload: { name: "Weddings", slug: "weddings" },
		});
		const body = created.json();

		expect(created.statusCode).toBe(201);
		expect(body.status).toBe("ACTIVE");
		expect(body.visibility).toBe("PUBLIC");
		expect(auditActions(mock)).toContain("tags.create");

		const duplicateSlug = await app.inject({
			method: "POST",
			url: "/v1/tags",
			headers: { cookie: adminCookie },
			payload: { name: "Other", slug: "weddings" },
		});

		expect(duplicateSlug.statusCode).toBe(409);

		const duplicateName = await app.inject({
			method: "POST",
			url: "/v1/tags",
			headers: { cookie: adminCookie },
			payload: { name: "Weddings", slug: "weddings-again" },
		});

		expect(duplicateName.statusCode).toBe(409);

		const invalidSlug = await app.inject({
			method: "POST",
			url: "/v1/tags",
			headers: { cookie: adminCookie },
			payload: { name: "Bad", slug: "Not A Slug" },
		});

		expect(invalidSlug.statusCode).toBe(400);
	});

	it("filters the list by visibility, status and search text", async () => {
		await app.inject({
			method: "POST",
			url: "/v1/tags",
			headers: { cookie: adminCookie },
			payload: { name: "Weddings", slug: "weddings" },
		});
		await app.inject({
			method: "POST",
			url: "/v1/tags",
			headers: { cookie: adminCookie },
			payload: { name: "Internal Review", slug: "internal-review", visibility: "INTERNAL", status: "INACTIVE" },
		});

		const internal = await app.inject({
			method: "GET",
			url: "/v1/tags?visibility=INTERNAL",
			headers: { cookie: adminCookie },
		});

		expect(internal.statusCode).toBe(200);
		expect(internal.json().total).toBe(1);
		expect(internal.json().items[0].slug).toBe("internal-review");

		const inactive = await app.inject({
			method: "GET",
			url: "/v1/tags?status=INACTIVE",
			headers: { cookie: adminCookie },
		});

		expect(inactive.json().total).toBe(1);

		const search = await app.inject({
			method: "GET",
			url: "/v1/tags?q=wed",
			headers: { cookie: adminCookie },
		});

		expect(search.json().total).toBe(1);
		expect(search.json().items[0].slug).toBe("weddings");

		const missing = await app.inject({
			method: "GET",
			url: "/v1/tags/00000000-0000-4000-8000-000000000000",
			headers: { cookie: adminCookie },
		});

		expect(missing.statusCode).toBe(404);
	});

	it("updates and deletes tags with audit records", async () => {
		const created = await app.inject({
			method: "POST",
			url: "/v1/tags",
			headers: { cookie: adminCookie },
			payload: { name: "Weddings", slug: "weddings" },
		});
		const tagId = created.json().id as string;

		const updated = await app.inject({
			method: "PATCH",
			url: `/v1/tags/${tagId}`,
			headers: { cookie: editorCookie },
			payload: { name: "Wedding", visibility: "INTERNAL", description: "Studio label" },
		});

		expect(updated.statusCode).toBe(200);
		expect(updated.json().name).toBe("Wedding");
		expect(updated.json().visibility).toBe("INTERNAL");
		expect(updated.json().description).toBe("Studio label");
		expect(auditActions(mock)).toContain("tags.update");

		const deleted = await app.inject({
			method: "DELETE",
			url: `/v1/tags/${tagId}`,
			headers: { cookie: adminCookie },
		});

		expect(deleted.statusCode).toBe(200);
		expect(deleted.json()).toEqual({ status: "deleted" });
		expect(auditActions(mock)).toContain("tags.delete");

		const detail = await app.inject({
			method: "GET",
			url: `/v1/tags/${tagId}`,
			headers: { cookie: adminCookie },
		});

		expect(detail.statusCode).toBe(404);
	});
});

describe("tag permission matrix", () => {
	it("requires a session, allows PHOTOGRAPHER and EDITOR writes and limits ASSISTANT to reads", async () => {
		const anonymous = await app.inject({ method: "GET", url: "/v1/tags" });

		expect(anonymous.statusCode).toBe(401);

		const assistantWrite = await app.inject({
			method: "POST",
			url: "/v1/tags",
			headers: { cookie: assistantCookie },
			payload: { name: "Nope", slug: "nope" },
		});

		expect(assistantWrite.statusCode).toBe(403);
		expect(assistantWrite.json().error.code).toBe("AUTHORIZATION_ERROR");

		const editorWrite = await app.inject({
			method: "POST",
			url: "/v1/tags",
			headers: { cookie: editorCookie },
			payload: { name: "Editor Tag", slug: "editor-tag" },
		});

		expect(editorWrite.statusCode).toBe(201);

		const photographerWrite = await app.inject({
			method: "POST",
			url: "/v1/tags",
			headers: { cookie: photographerCookie },
			payload: { name: "Photo Tag", slug: "photo-tag" },
		});

		expect(photographerWrite.statusCode).toBe(201);

		const accountantRead = await app.inject({
			method: "GET",
			url: "/v1/tags",
			headers: { cookie: accountantCookie },
		});

		expect(accountantRead.statusCode).toBe(200);
		expect(accountantRead.json().total).toBe(2);
	});
});
