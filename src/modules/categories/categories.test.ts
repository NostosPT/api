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

async function createCategory(cookie: string, name: string, slug: string) {
	return app.inject({
		method: "POST",
		url: "/v1/categories",
		headers: { cookie },
		payload: { name, slug },
	});
}

describe("category management", () => {
	it("assigns ordered positions and rejects duplicates and invalid slugs", async () => {
		const first = await createCategory(adminCookie, "Weddings", "weddings");
		const second = await createCategory(adminCookie, "Portraits", "portraits");

		expect(first.statusCode).toBe(201);
		expect(first.json().position).toBe(1);
		expect(first.json().status).toBe("ACTIVE");
		expect(second.json().position).toBe(2);
		expect(auditActions(mock)).toContain("categories.create");

		const duplicateSlug = await app.inject({
			method: "POST",
			url: "/v1/categories",
			headers: { cookie: adminCookie },
			payload: { name: "Other", slug: "weddings" },
		});

		expect(duplicateSlug.statusCode).toBe(409);

		const duplicateName = await app.inject({
			method: "POST",
			url: "/v1/categories",
			headers: { cookie: adminCookie },
			payload: { name: "Weddings", slug: "weddings-again" },
		});

		expect(duplicateName.statusCode).toBe(409);

		const invalidSlug = await app.inject({
			method: "POST",
			url: "/v1/categories",
			headers: { cookie: adminCookie },
			payload: { name: "Bad", slug: "Not A Slug" },
		});

		expect(invalidSlug.statusCode).toBe(400);

		const list = await app.inject({
			method: "GET",
			url: "/v1/categories",
			headers: { cookie: adminCookie },
		});
		const listBody = list.json();

		expect(list.statusCode).toBe(200);
		expect(listBody.total).toBe(2);
		expect(listBody.items.map((category: { slug: string }) => category.slug)).toEqual(["weddings", "portraits"]);
	});

	it("reorders categories with move and rejects moves past the ends", async () => {
		await createCategory(adminCookie, "Weddings", "weddings");
		await createCategory(adminCookie, "Portraits", "portraits");
		const third = await createCategory(adminCookie, "Families", "families");
		const thirdId = third.json().id as string;

		const moved = await app.inject({
			method: "POST",
			url: `/v1/categories/${thirdId}/move`,
			headers: { cookie: adminCookie },
			payload: { direction: "up" },
		});

		expect(moved.statusCode).toBe(200);
		expect(moved.json().position).toBe(2);
		expect(auditActions(mock)).toContain("categories.move");

		const list = await app.inject({
			method: "GET",
			url: "/v1/categories",
			headers: { cookie: adminCookie },
		});

		expect(list.json().items.map((category: { position: number }) => category.position)).toEqual([1, 2, 3]);
		expect(list.json().items[1].slug).toBe("families");

		const firstId = list.json().items[0].id as string;
		const lastId = list.json().items[2].id as string;

		const aboveTop = await app.inject({
			method: "POST",
			url: `/v1/categories/${firstId}/move`,
			headers: { cookie: adminCookie },
			payload: { direction: "up" },
		});

		expect(aboveTop.statusCode).toBe(400);

		const belowBottom = await app.inject({
			method: "POST",
			url: `/v1/categories/${lastId}/move`,
			headers: { cookie: adminCookie },
			payload: { direction: "down" },
		});

		expect(belowBottom.statusCode).toBe(400);
	});

	it("moves across gaps left by deleted categories", async () => {
		await createCategory(adminCookie, "Weddings", "weddings");
		const middle = await createCategory(adminCookie, "Portraits", "portraits");
		const last = await createCategory(adminCookie, "Families", "families");

		const deleted = await app.inject({
			method: "DELETE",
			url: `/v1/categories/${middle.json().id as string}`,
			headers: { cookie: adminCookie },
		});

		expect(deleted.statusCode).toBe(200);

		const moved = await app.inject({
			method: "POST",
			url: `/v1/categories/${last.json().id as string}/move`,
			headers: { cookie: adminCookie },
			payload: { direction: "up" },
		});

		expect(moved.statusCode).toBe(200);
		expect(moved.json().position).toBe(1);

		const list = await app.inject({
			method: "GET",
			url: "/v1/categories",
			headers: { cookie: adminCookie },
		});

		expect(list.json().items.map((category: { slug: string }) => category.slug)).toEqual(["families", "weddings"]);
		expect(list.json().items.map((category: { position: number }) => category.position)).toEqual([1, 3]);
	});

	it("updates and deletes categories with audit records", async () => {
		const created = await createCategory(adminCookie, "Weddings", "weddings");
		const categoryId = created.json().id as string;

		const updated = await app.inject({
			method: "PATCH",
			url: `/v1/categories/${categoryId}`,
			headers: { cookie: editorCookie },
			payload: { name: "Wedding", status: "INACTIVE", description: "Seasonal" },
		});

		expect(updated.statusCode).toBe(200);
		expect(updated.json().name).toBe("Wedding");
		expect(updated.json().status).toBe("INACTIVE");
		expect(updated.json().description).toBe("Seasonal");
		expect(auditActions(mock)).toContain("categories.update");

		const deleted = await app.inject({
			method: "DELETE",
			url: `/v1/categories/${categoryId}`,
			headers: { cookie: adminCookie },
		});

		expect(deleted.statusCode).toBe(200);
		expect(deleted.json()).toEqual({ status: "deleted" });
		expect(auditActions(mock)).toContain("categories.delete");

		const detail = await app.inject({
			method: "GET",
			url: `/v1/categories/${categoryId}`,
			headers: { cookie: adminCookie },
		});

		expect(detail.statusCode).toBe(404);
	});
});

describe("category permission matrix", () => {
	it("requires a session, allows PHOTOGRAPHER writes and limits ASSISTANT to reads", async () => {
		const anonymous = await app.inject({ method: "GET", url: "/v1/categories" });

		expect(anonymous.statusCode).toBe(401);

		const assistantWrite = await app.inject({
			method: "POST",
			url: "/v1/categories",
			headers: { cookie: assistantCookie },
			payload: { name: "Nope", slug: "nope" },
		});

		expect(assistantWrite.statusCode).toBe(403);
		expect(assistantWrite.json().error.code).toBe("AUTHORIZATION_ERROR");

		const photographerWrite = await createCategory(photographerCookie, "Photo Cat", "photo-cat");

		expect(photographerWrite.statusCode).toBe(201);

		const accountantRead = await app.inject({
			method: "GET",
			url: "/v1/categories",
			headers: { cookie: accountantCookie },
		});

		expect(accountantRead.statusCode).toBe(200);
		expect(accountantRead.json().total).toBe(1);
	});
});
