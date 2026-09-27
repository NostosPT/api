import "../../test/env.js";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { createMockPrisma, mockId, resetMock, resetMockIds, type MockPrisma } from "../../test/prisma-mock.js";

const holder = { prisma: createMockPrisma() };

vi.mock("../../db/prisma.js", () => ({ prisma: holder.prisma }));

// Mutable storage behavior so failure paths (missing object, wrong magic
// bytes, size cap, sha mismatch) can be exercised per test.
const storageState = {
	putUrl: "https://storage.test/upload/original" as string | null,
	headSize: 1024,
	magic: new Uint8Array([0xFF, 0xD8, 0xFF]),
	sha256: null as string | null,
	objectMissing: false,
};

vi.mock("../../storage/index.js", () => ({
	storage: {
		presignPut: async () => storageState.putUrl,
		presignGet: async (key: string) => `https://storage.test/read/${key}`,
		headObject: async () => (storageState.objectMissing ? null : { size: storageState.headSize }),
		getFirstBytes: async () => (storageState.objectMissing ? null : storageState.magic),
		getObjectSha256: async () => storageState.sha256,
	},
}));

import { createApp } from "../../app.js";
import { auditActions, seedSession, seedUser, sessionCookie } from "../../test/helpers.js";

vi.setConfig({ testTimeout: 30_000 });

let app: FastifyInstance;
let mock: MockPrisma;
let adminCookie = "";
let photographerCookie = "";
let otherPhotographerCookie = "";
let editorCookie = "";
let assistantCookie = "";
let accountantCookie = "";
let photographerId = "";
let otherPhotographerId = "";

beforeAll(async () => {
	app = await createApp();
});

beforeEach(async () => {
	resetMockIds();
	resetMock(holder.prisma);
	mock = holder.prisma;

	storageState.putUrl = "https://storage.test/upload/original";
	storageState.headSize = 1024;
	storageState.magic = new Uint8Array([0xFF, 0xD8, 0xFF]);
	storageState.sha256 = null;
	storageState.objectMissing = false;

	const admin = await seedUser(mock, { email: "admin@nostos.photos", role: "ADMIN" });
	const photographer = await seedUser(mock, { email: "photo@nostos.photos", role: "PHOTOGRAPHER" });
	const otherPhotographer = await seedUser(mock, { email: "photo2@nostos.photos", role: "PHOTOGRAPHER" });
	const editor = await seedUser(mock, { email: "editor@nostos.photos", role: "EDITOR" });
	const assistant = await seedUser(mock, { email: "assistant@nostos.photos", role: "ASSISTANT" });
	const accountant = await seedUser(mock, { email: "money@nostos.photos", role: "ACCOUNTANT" });

	photographerId = photographer.id;
	otherPhotographerId = otherPhotographer.id;

	adminCookie = sessionCookie(await seedSession(mock, admin.id));
	photographerCookie = sessionCookie(await seedSession(mock, photographer.id));
	otherPhotographerCookie = sessionCookie(await seedSession(mock, otherPhotographer.id));
	editorCookie = sessionCookie(await seedSession(mock, editor.id));
	assistantCookie = sessionCookie(await seedSession(mock, assistant.id));
	accountantCookie = sessionCookie(await seedSession(mock, accountant.id));
});

async function createIntent(cookie: string, payload: Record<string, unknown> = { contentType: "image/jpeg" }) {
	return app.inject({
		method: "POST",
		url: "/v1/photos/uploads",
		headers: { cookie },
		payload,
	});
}

async function registerPhoto(cookie: string, originalKey: string, extra: Record<string, unknown> = {}) {
	return app.inject({
		method: "POST",
		url: "/v1/photos",
		headers: { cookie },
		payload: { originalKey, ...extra },
	});
}

describe("photo upload and registration", () => {
	it("creates a presigned intent, registers the photo and hides pending rows", async () => {
		const intent = await createIntent(adminCookie);

		expect(intent.statusCode).toBe(201);

		const { key, uploadUrl } = intent.json();

		expect(key).toMatch(/^originals\/[0-9a-f-]+$/);
		expect(uploadUrl).toBe("https://storage.test/upload/original");

		const pendingRow = mock.photo.rows.find((row) => row.originalKey === key);

		expect(pendingRow?.uploadStatus).toBe("PENDING");

		const listWithPending = await app.inject({
			method: "GET",
			url: "/v1/photos",
			headers: { cookie: adminCookie },
		});

		expect(listWithPending.json().total).toBe(0);

		const registered = await registerPhoto(adminCookie, key, {
			title: "Bell tower",
			width: 1600,
			height: 1067,
			visibility: "PUBLIC",
			category: "Urban",
			watermarked: true,
		});

		expect(registered.statusCode).toBe(201);

		const photo = registered.json();

		expect(photo.number).toBe(1);
		expect(photo.uploadStatus).toBe("READY");
		expect(photo.status).toBe("DRAFT");
		expect(photo.visibility).toBe("PUBLIC");
		expect(photo.urls.original).toBe(`https://storage.test/read/${key}`);
		expect(auditActions(mock)).toContain("photos.create");

		const duplicate = await registerPhoto(adminCookie, key);

		expect(duplicate.statusCode).toBe(409);

		const list = await app.inject({
			method: "GET",
			url: "/v1/photos",
			headers: { cookie: adminCookie },
		});

		expect(list.statusCode).toBe(200);
		expect(list.json().total).toBe(1);
		expect(list.json().items[0].title).toBe("Bell tower");

		const search = await app.inject({
			method: "GET",
			url: "/v1/photos?q=bell",
			headers: { cookie: adminCookie },
		});

		expect(search.json().total).toBe(1);

		const miss = await app.inject({
			method: "GET",
			url: "/v1/photos?q=other",
			headers: { cookie: adminCookie },
		});

		expect(miss.json().total).toBe(0);
	});

	it("rejects unsupported inputs and verifies object, magic bytes, size and integrity", async () => {
		const badType = await createIntent(adminCookie, { contentType: "application/pdf" });

		expect(badType.statusCode).toBe(400);
		expect(badType.json().error.code).toBe("VALIDATION_ERROR");

		const badExtension = await createIntent(adminCookie, { contentType: "image/jpeg", filename: "run.exe" });

		expect(badExtension.statusCode).toBe(400);

		const intent = await createIntent(adminCookie);
		const key = intent.json().key as string;

		storageState.objectMissing = true;
		const missing = await registerPhoto(adminCookie, key);

		expect(missing.statusCode).toBe(400);

		storageState.objectMissing = false;
		storageState.magic = new Uint8Array([0x00, 0x01, 0x02]);
		const wrongMagic = await registerPhoto(adminCookie, key);

		expect(wrongMagic.statusCode).toBe(400);
		expect(mock.photo.rows.find((row) => row.originalKey === key)?.uploadStatus).toBe("FAILED");

		storageState.magic = new Uint8Array([0xFF, 0xD8, 0xFF]);
		storageState.headSize = 60 * 1024 * 1024;
		const tooLarge = await registerPhoto(adminCookie, key);

		expect(tooLarge.statusCode).toBe(400);

		storageState.headSize = 1024;
		storageState.sha256 = "a".repeat(64);
		const badHash = await registerPhoto(adminCookie, key, { sha256: "b".repeat(64) });

		expect(badHash.statusCode).toBe(400);
		expect(badHash.json().error.code).toBe("VALIDATION_ERROR");

		storageState.sha256 = "a".repeat(64);
		const verified = await registerPhoto(adminCookie, key, { sha256: "A".repeat(64) });

		expect(verified.statusCode).toBe(201);
		expect(verified.json().uploadStatus).toBe("READY");
	});

	it("serves 503 when storage is not configured", async () => {
		storageState.putUrl = null;

		const intent = await createIntent(adminCookie);

		expect(intent.statusCode).toBe(503);
		expect(intent.json().error.code).toBe("SERVICE_UNAVAILABLE");
		expect(mock.photo.rows).toHaveLength(0);
	});
});

describe("photo publishing", () => {
	it("walks DRAFT to PUBLISHED and back with audit records", async () => {
		const intent = await createIntent(adminCookie);
		const registered = await registerPhoto(adminCookie, intent.json().key as string, { title: "Ave" });
		const id = registered.json().id as string;

		await createIntent(adminCookie);

		const publishBlocked = await app.inject({
			method: "POST",
			url: `/v1/photos/${mock.photo.rows.find((row) => row.uploadStatus === "PENDING")?.id as string}/publish`,
			headers: { cookie: adminCookie },
		});

		expect(publishBlocked.statusCode).toBe(400);

		const first = await app.inject({
			method: "POST",
			url: `/v1/photos/${id}/publish`,
			headers: { cookie: adminCookie },
		});

		expect(first.statusCode).toBe(200);
		expect(first.json().status).toBe("APPROVED");

		const second = await app.inject({
			method: "POST",
			url: `/v1/photos/${id}/publish`,
			headers: { cookie: adminCookie },
		});

		expect(second.json().status).toBe("PUBLISHED");

		const third = await app.inject({
			method: "POST",
			url: `/v1/photos/${id}/publish`,
			headers: { cookie: adminCookie },
		});

		expect(third.statusCode).toBe(400);
		expect(third.json().error.code).toBe("VALIDATION_ERROR");
		expect(auditActions(mock)).toContain("photos.publish");

		const patched = await app.inject({
			method: "PATCH",
			url: `/v1/photos/${id}`,
			headers: { cookie: editorCookie },
			payload: { visibility: "PUBLIC", availability: "AVAILABLE" },
		});

		expect(patched.statusCode).toBe(200);
		expect(patched.json().visibility).toBe("PUBLIC");
		expect(auditActions(mock)).toContain("photos.update");

		const unpublished = await app.inject({
			method: "POST",
			url: `/v1/photos/${id}/unpublish`,
			headers: { cookie: editorCookie },
		});

		expect(unpublished.json().status).toBe("DRAFT");
		expect(auditActions(mock)).toContain("photos.unpublish");

		const again = await app.inject({
			method: "POST",
			url: `/v1/photos/${id}/unpublish`,
			headers: { cookie: editorCookie },
		});

		expect(again.statusCode).toBe(400);
	});
});

describe("photo access scope and deletion", () => {
	it("scopes PHOTOGRAPHER to their own photos and blocks other roles", async () => {
		const adminIntent = await createIntent(adminCookie);
		const adminPhoto = await registerPhoto(adminCookie, adminIntent.json().key as string, {
			photographerId,
			title: "Own",
		});
		const ownId = adminPhoto.json().id as string;

		const secondIntent = await createIntent(adminCookie);
		const archivePhoto = await registerPhoto(adminCookie, secondIntent.json().key as string, {
			title: "Archive",
		});
		const archiveId = archivePhoto.json().id as string;

		const own = await app.inject({
			method: "GET",
			url: `/v1/photos/${ownId}`,
			headers: { cookie: photographerCookie },
		});

		expect(own.statusCode).toBe(200);

		const foreign = await app.inject({
			method: "GET",
			url: `/v1/photos/${archiveId}`,
			headers: { cookie: otherPhotographerCookie },
		});

		expect(foreign.statusCode).toBe(403);
		expect(foreign.json().error.code).toBe("AUTHORIZATION_ERROR");

		const foreignWrite = await app.inject({
			method: "PATCH",
			url: `/v1/photos/${ownId}`,
			headers: { cookie: otherPhotographerCookie },
			payload: { title: "Stolen" },
		});

		expect(foreignWrite.statusCode).toBe(403);

		const scopedList = await app.inject({
			method: "GET",
			url: "/v1/photos",
			headers: { cookie: photographerCookie },
		});

		expect(scopedList.json().total).toBe(1);
		expect(scopedList.json().items[0].id).toBe(ownId);

		const foreignFilter = await app.inject({
			method: "GET",
			url: `/v1/photos?photographerId=${otherPhotographerId}`,
			headers: { cookie: photographerCookie },
		});

		expect(foreignFilter.statusCode).toBe(403);

		const assistantRead = await app.inject({
			method: "GET",
			url: `/v1/photos/${archiveId}`,
			headers: { cookie: assistantCookie },
		});

		expect(assistantRead.statusCode).toBe(200);

		const accountantRead = await app.inject({
			method: "GET",
			url: "/v1/photos",
			headers: { cookie: accountantCookie },
		});

		expect(accountantRead.statusCode).toBe(403);

		const assistantWrite = await app.inject({
			method: "POST",
			url: "/v1/photos/uploads",
			headers: { cookie: assistantCookie },
			payload: { contentType: "image/jpeg" },
		});

		expect(assistantWrite.statusCode).toBe(403);
	});

	it("blocks deleting referenced photos and allows unreferenced deletes", async () => {
		const intent = await createIntent(adminCookie);
		const registered = await registerPhoto(adminCookie, intent.json().key as string, { title: "Del" });
		const id = registered.json().id as string;

		mock.albumPhoto.rows.push({
			albumId: mockId(),
			photoId: id,
			position: 1,
			isPreview: true,
			addedAt: new Date(),
		});

		const referenced = await app.inject({
			method: "DELETE",
			url: `/v1/photos/${id}`,
			headers: { cookie: adminCookie },
		});

		expect(referenced.statusCode).toBe(409);
		expect(referenced.json().error.code).toBe("CONFLICT");

		mock.albumPhoto.rows.length = 0;

		const deleted = await app.inject({
			method: "DELETE",
			url: `/v1/photos/${id}`,
			headers: { cookie: adminCookie },
		});

		expect(deleted.statusCode).toBe(200);
		expect(deleted.json()).toEqual({ status: "deleted" });
		expect(auditActions(mock)).toContain("photos.delete");

		const detail = await app.inject({
			method: "GET",
			url: `/v1/photos/${id}`,
			headers: { cookie: adminCookie },
		});

		expect(detail.statusCode).toBe(404);
	});
});

describe("photo category and tag assignment", () => {
	let photoId = "";
	let categoryId = "";
	let tagId = "";

	beforeEach(async () => {
		const admin = await seedUser(mock, { email: "admin@test.com", role: "ADMIN" });
		const adminC = sessionCookie(await seedSession(mock, admin.id));

		const photo = await registerPhoto(adminC, "originals/test-cat-tag.jpg", {
			title: "Test Photo",
			visibility: "PUBLIC",
		});
		photoId = photo.json().id;

		const category = mock.category.create({
			data: { name: "Landscapes", slug: "landscapes", status: "ACTIVE", position: 1 },
		}) as { id: string };
		categoryId = category.id;

		const tag = mock.tag.create({
			data: { name: "Sunset", slug: "sunset", status: "ACTIVE", visibility: "PUBLIC" },
		}) as { id: string };
		tagId = tag.id;
	});

	it("assigns and removes a category", async () => {
		const add = await app.inject({
			method: "POST",
			url: `/v1/photos/${photoId}/categories/${categoryId}`,
			headers: { cookie: adminCookie },
		});
		expect(add.statusCode).toBe(200);
		expect(add.json()).toEqual({ status: "added" });
		expect(auditActions(mock)).toContain("photos.categories.add");

		const duplicate = await app.inject({
			method: "POST",
			url: `/v1/photos/${photoId}/categories/${categoryId}`,
			headers: { cookie: adminCookie },
		});
		expect(duplicate.statusCode).toBe(200);

		const remove = await app.inject({
			method: "DELETE",
			url: `/v1/photos/${photoId}/categories/${categoryId}`,
			headers: { cookie: adminCookie },
		});
		expect(remove.statusCode).toBe(200);
		expect(remove.json()).toEqual({ status: "removed" });
		expect(auditActions(mock)).toContain("photos.categories.remove");
	});

	it("assigns and removes a tag", async () => {
		const add = await app.inject({
			method: "POST",
			url: `/v1/photos/${photoId}/tags/${tagId}`,
			headers: { cookie: adminCookie },
		});
		expect(add.statusCode).toBe(200);
		expect(add.json()).toEqual({ status: "added" });
		expect(auditActions(mock)).toContain("photos.tags.add");

		const duplicate = await app.inject({
			method: "POST",
			url: `/v1/photos/${photoId}/tags/${tagId}`,
			headers: { cookie: adminCookie },
		});
		expect(duplicate.statusCode).toBe(200);

		const remove = await app.inject({
			method: "DELETE",
			url: `/v1/photos/${photoId}/tags/${tagId}`,
			headers: { cookie: adminCookie },
		});
		expect(remove.statusCode).toBe(200);
		expect(remove.json()).toEqual({ status: "removed" });
		expect(auditActions(mock)).toContain("photos.tags.remove");
	});

	it("returns 404 for unknown category", async () => {
		const res = await app.inject({
			method: "POST",
			url: `/v1/photos/${photoId}/categories/00000000-0000-4000-8000-000000000042`,
			headers: { cookie: adminCookie },
		});
		expect(res.statusCode).toBe(404);
	});

	it("returns 404 for unknown tag", async () => {
		const res = await app.inject({
			method: "POST",
			url: `/v1/photos/${photoId}/tags/00000000-0000-4000-8000-000000000042`,
			headers: { cookie: adminCookie },
		});
		expect(res.statusCode).toBe(404);
	});

	it("enforces PHOTOGRAPHER own-photo rule for category assignment", async () => {
		const res = await app.inject({
			method: "POST",
			url: `/v1/photos/${photoId}/categories/${categoryId}`,
			headers: { cookie: otherPhotographerCookie },
		});
		expect(res.statusCode).toBe(403);
	});

	it("enforces PHOTOGRAPHER own-photo rule for tag assignment", async () => {
		const res = await app.inject({
			method: "POST",
			url: `/v1/photos/${photoId}/tags/${tagId}`,
			headers: { cookie: otherPhotographerCookie },
		});
		expect(res.statusCode).toBe(403);
	});

	it("allows EDITOR to assign categories/tags to any photo", async () => {
		const addCat = await app.inject({
			method: "POST",
			url: `/v1/photos/${photoId}/categories/${categoryId}`,
			headers: { cookie: editorCookie },
		});
		expect(addCat.statusCode).toBe(200);

		const addTag = await app.inject({
			method: "POST",
			url: `/v1/photos/${photoId}/tags/${tagId}`,
			headers: { cookie: editorCookie },
		});
		expect(addTag.statusCode).toBe(200);
	});

	it("denies ASSISTANT category/tag assignment", async () => {
		const res = await app.inject({
			method: "POST",
			url: `/v1/photos/${photoId}/categories/${categoryId}`,
			headers: { cookie: assistantCookie },
		});
		expect(res.statusCode).toBe(403);
	});

	it("denies ACCOUNTANT category/tag assignment", async () => {
		const res = await app.inject({
			method: "POST",
			url: `/v1/photos/${photoId}/categories/${categoryId}`,
			headers: { cookie: accountantCookie },
		});
		expect(res.statusCode).toBe(403);
	});
});
