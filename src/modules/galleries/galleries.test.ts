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
let photoA = "";
let photoB = "";
let photoC = "";

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

	photoA = (mock.photo.create({
		data: { originalKey: "originals/a.jpg", status: "PUBLISHED", uploadStatus: "READY", visibility: "PUBLIC", availability: "AVAILABLE", currency: "EUR" },
	}) as { id: string }).id;
	photoB = (mock.photo.create({
		data: { originalKey: "originals/b.jpg", status: "DRAFT", uploadStatus: "READY", visibility: "PRIVATE", availability: "NOT_FOR_SALE", currency: "EUR" },
	}) as { id: string }).id;
	photoC = (mock.photo.create({
		data: { originalKey: "originals/c.jpg", status: "PUBLISHED", uploadStatus: "READY", visibility: "PUBLIC", availability: "AVAILABLE", currency: "EUR" },
	}) as { id: string }).id;
});

async function createGallery(cookie: string, payload: Record<string, unknown>) {
	return app.inject({
		method: "POST",
		url: "/v1/galleries",
		headers: { cookie },
		payload,
	});
}

describe("gallery CRUD", () => {
	it("creates galleries with generated or explicit slugs and guards conflicts", async () => {
		const generated = await createGallery(adminCookie, { title: "Street work" });

		expect(generated.statusCode).toBe(201);
		expect(generated.json().status).toBe("DRAFT");
		expect(generated.json().slug).toMatch(/^street-work-[0-9a-f]{6}$/);
		expect(generated.json().entries).toEqual([]);
		expect(auditActions(mock)).toContain("galleries.create");

		const explicit = await createGallery(adminCookie, { title: "Weddings", slug: "weddings-2026", position: 1 });

		expect(explicit.statusCode).toBe(201);
		expect(explicit.json().slug).toBe("weddings-2026");
		expect(explicit.json().position).toBe(1);

		const duplicateSlug = await createGallery(adminCookie, { title: "Copy", slug: "weddings-2026" });

		expect(duplicateSlug.statusCode).toBe(409);

		const duplicatePosition = await createGallery(adminCookie, { title: "Second", position: 1 });

		expect(duplicatePosition.statusCode).toBe(409);

		const unknown = await app.inject({
			method: "GET",
			url: "/v1/galleries/00000000-0000-4000-8000-000000000042",
			headers: { cookie: adminCookie },
		});

		expect(unknown.statusCode).toBe(404);
	});

	it("updates metadata and rejects position collisions", async () => {
		const first = await createGallery(adminCookie, { title: "First", position: 1 });
		const second = await createGallery(adminCookie, { title: "Second", position: 2 });

		const collision = await app.inject({
			method: "PATCH",
			url: `/v1/galleries/${second.json().id as string}`,
			headers: { cookie: adminCookie },
			payload: { position: 1 },
		});

		expect(collision.statusCode).toBe(409);

		const updated = await app.inject({
			method: "PATCH",
			url: `/v1/galleries/${first.json().id as string}`,
			headers: { cookie: adminCookie },
			payload: { title: "First revised", description: "Curated", position: null },
		});

		expect(updated.statusCode).toBe(200);
		expect(updated.json().title).toBe("First revised");
		expect(updated.json().description).toBe("Curated");
		expect(updated.json().position).toBe(null);
		expect(auditActions(mock)).toContain("galleries.update");

		const nowFree = await app.inject({
			method: "PATCH",
			url: `/v1/galleries/${second.json().id as string}`,
			headers: { cookie: adminCookie },
			payload: { position: 1 },
		});

		expect(nowFree.statusCode).toBe(200);
		expect(nowFree.json().position).toBe(1);
	});
});

describe("gallery lifecycle", () => {
	it("publishes, unpublishes, and archives with status guards", async () => {
		const created = await createGallery(adminCookie, { title: "Portfolio" });
		const id = created.json().id as string;

		const published = await app.inject({
			method: "POST",
			url: `/v1/galleries/${id}/publish`,
			headers: { cookie: editorCookie },
		});

		expect(published.statusCode).toBe(200);
		expect(published.json().status).toBe("PUBLISHED");
		expect(auditActions(mock)).toContain("galleries.publish");

		const publishedAgain = await app.inject({
			method: "POST",
			url: `/v1/galleries/${id}/publish`,
			headers: { cookie: adminCookie },
		});

		expect(publishedAgain.statusCode).toBe(400);

		const unpublished = await app.inject({
			method: "POST",
			url: `/v1/galleries/${id}/unpublish`,
			headers: { cookie: photographerCookie },
		});

		expect(unpublished.statusCode).toBe(200);
		expect(unpublished.json().status).toBe("DRAFT");
		expect(auditActions(mock)).toContain("galleries.unpublish");

		const unpublishedAgain = await app.inject({
			method: "POST",
			url: `/v1/galleries/${id}/unpublish`,
			headers: { cookie: adminCookie },
		});

		expect(unpublishedAgain.statusCode).toBe(400);

		await createGallery(adminCookie, { title: "Kept" });

		const archived = await app.inject({
			method: "DELETE",
			url: `/v1/galleries/${id}`,
			headers: { cookie: adminCookie },
		});

		expect(archived.statusCode).toBe(200);
		expect(archived.json()).toEqual({ status: "archived" });
		expect(auditActions(mock)).toContain("galleries.archive");

		const archivedAgain = await app.inject({
			method: "DELETE",
			url: `/v1/galleries/${id}`,
			headers: { cookie: adminCookie },
		});

		expect(archivedAgain.statusCode).toBe(409);

		const publishArchived = await app.inject({
			method: "POST",
			url: `/v1/galleries/${id}/publish`,
			headers: { cookie: adminCookie },
		});

		expect(publishArchived.statusCode).toBe(400);

		const visible = await app.inject({
			method: "GET",
			url: "/v1/galleries",
			headers: { cookie: adminCookie },
		});

		expect(visible.json().total).toBe(1);
		expect(visible.json().items[0].title).toBe("Kept");

		const archivedList = await app.inject({
			method: "GET",
			url: "/v1/galleries?status=ARCHIVED",
			headers: { cookie: adminCookie },
		});

		expect(archivedList.json().total).toBe(1);
		expect(archivedList.json().items[0].id).toBe(id);
	});
});

describe("gallery membership and featured flags", () => {
	it("replaces membership with dense positions and toggles featured", async () => {
		const created = await createGallery(adminCookie, { title: "Members" });
		const id = created.json().id as string;

		const set = await app.inject({
			method: "PUT",
			url: `/v1/galleries/${id}/photos`,
			headers: { cookie: adminCookie },
			payload: { photoIds: [photoB, photoA, photoB] },
		});

		expect(set.statusCode).toBe(200);
		expect(set.json().entries).toEqual([
			{ photoId: photoB, position: 1, isFeatured: false },
			{ photoId: photoA, position: 2, isFeatured: false },
		]);
		expect(auditActions(mock)).toContain("galleries.photos.set");

		const missing = await app.inject({
			method: "PUT",
			url: `/v1/galleries/${id}/photos`,
			headers: { cookie: adminCookie },
			payload: { photoIds: ["00000000-0000-4000-8000-000000000042"] },
		});

		expect(missing.statusCode).toBe(400);

		const featured = await app.inject({
			method: "PATCH",
			url: `/v1/galleries/${id}/photos/${photoA}`,
			headers: { cookie: editorCookie },
			payload: { isFeatured: true },
		});

		expect(featured.statusCode).toBe(200);
		expect(featured.json().entries.find((entry: { photoId: string }) => entry.photoId === photoA).isFeatured)
			.toBe(true);
		expect(auditActions(mock)).toContain("galleries.photos.update");

		const notMember = await app.inject({
			method: "PATCH",
			url: `/v1/galleries/${id}/photos/${photoC}`,
			headers: { cookie: adminCookie },
			payload: { isFeatured: true },
		});

		expect(notMember.statusCode).toBe(404);
	});

	it("replaces membership with one bulk insert and resets featured flags", async () => {
		const created = await createGallery(adminCookie, { title: "Bulk" });
		const id = created.json().id as string;

		await app.inject({
			method: "PUT",
			url: `/v1/galleries/${id}/photos`,
			headers: { cookie: adminCookie },
			payload: { photoIds: [photoA, photoB] },
		});

		await app.inject({
			method: "PATCH",
			url: `/v1/galleries/${id}/photos/${photoA}`,
			headers: { cookie: adminCookie },
			payload: { isFeatured: true },
		});

		const createMany = vi.spyOn(mock.galleryPhoto, "createMany");
		const create = vi.spyOn(mock.galleryPhoto, "create");

		const replaced = await app.inject({
			method: "PUT",
			url: `/v1/galleries/${id}/photos`,
			headers: { cookie: adminCookie },
			payload: { photoIds: [photoC, photoA, photoB] },
		});

		expect(replaced.statusCode).toBe(200);
		expect(replaced.json().entries).toEqual([
			{ photoId: photoC, position: 1, isFeatured: false },
			{ photoId: photoA, position: 2, isFeatured: false },
			{ photoId: photoB, position: 3, isFeatured: false },
		]);
		expect(createMany).toHaveBeenCalledTimes(1);
		expect(create).not.toHaveBeenCalled();

		createMany.mockRestore();
		create.mockRestore();
	});
});

describe("gallery permission matrix", () => {
	it("follows ADMIN M, PHOTOGRAPHER P, EDITOR P, ASSISTANT R, ACCOUNTANT none", async () => {
		const anonymous = await app.inject({ method: "GET", url: "/v1/galleries" });

		expect(anonymous.statusCode).toBe(401);

		const accountant = await app.inject({
			method: "GET",
			url: "/v1/galleries",
			headers: { cookie: accountantCookie },
		});

		expect(accountant.statusCode).toBe(403);

		const assistantRead = await app.inject({
			method: "GET",
			url: "/v1/galleries",
			headers: { cookie: assistantCookie },
		});

		expect(assistantRead.statusCode).toBe(200);

		const assistantCreate = await createGallery(assistantCookie, { title: "Nope" });

		expect(assistantCreate.statusCode).toBe(403);

		const created = await createGallery(adminCookie, { title: "Rights" });
		const id = created.json().id as string;

		const editorCreate = await createGallery(editorCookie, { title: "Nope" });

		expect(editorCreate.statusCode).toBe(403);

		const editorMeta = await app.inject({
			method: "PATCH",
			url: `/v1/galleries/${id}`,
			headers: { cookie: editorCookie },
			payload: { title: "Renamed" },
		});

		expect(editorMeta.statusCode).toBe(403);

		const editorPublish = await app.inject({
			method: "POST",
			url: `/v1/galleries/${id}/publish`,
			headers: { cookie: editorCookie },
		});

		expect(editorPublish.statusCode).toBe(200);

		const photographerCurate = await app.inject({
			method: "PUT",
			url: `/v1/galleries/${id}/photos`,
			headers: { cookie: photographerCookie },
			payload: { photoIds: [photoA, photoC] },
		});

		expect(photographerCurate.statusCode).toBe(200);

		const photographerCreate = await createGallery(photographerCookie, { title: "Nope" });

		expect(photographerCreate.statusCode).toBe(403);

		const photographerArchive = await app.inject({
			method: "DELETE",
			url: `/v1/galleries/${id}`,
			headers: { cookie: photographerCookie },
		});

		expect(photographerArchive.statusCode).toBe(403);
	});
});
