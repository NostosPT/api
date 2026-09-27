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
let clientId = "";

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

	const client = await app.inject({
		method: "POST",
		url: "/v1/clients",
		headers: { cookie: adminCookie },
		payload: { name: "Ana Silva", email: "ana@example.com" },
	});

	clientId = client.json().id as string;
});

function seedPhoto(originalKey: string): string {
	return (mock.photo.create({
		data: {
			originalKey,
			status: "DRAFT",
			uploadStatus: "READY",
			visibility: "PRIVATE",
			availability: "NOT_FOR_SALE",
			currency: "EUR",
		},
	}) as { id: string }).id;
}

async function createAlbum(cookie: string, payload: Record<string, unknown>) {
	return app.inject({
		method: "POST",
		url: "/v1/albums",
		headers: { cookie },
		payload,
	});
}

describe("album management", () => {
	it("creates albums with generated slugs, validates references and filters the list", async () => {
		const created = await createAlbum(adminCookie, {
			clientId,
			title: "The city, slowly",
			type: "WATERMARK",
		});

		expect(created.statusCode).toBe(201);

		const album = created.json();

		expect(album.slug).toMatch(/^the-city-slowly-[0-9a-f]{6}$/);
		expect(album.status).toBe("DRAFT");
		expect(album.hasAccessCode).toBe(false);
		expect(album.secretVersion).toBe(1);
		expect(album.photoIds).toEqual([]);
		expect(auditActions(mock)).toContain("albums.create");

		const fixed = await createAlbum(adminCookie, {
			clientId,
			title: "Fixed",
			type: "FREE",
			slug: "fixed-slug",
		});

		expect(fixed.statusCode).toBe(201);

		const duplicateSlug = await createAlbum(adminCookie, {
			clientId,
			title: "Other",
			type: "FREE",
			slug: "fixed-slug",
		});

		expect(duplicateSlug.statusCode).toBe(409);

		const badSlug = await createAlbum(adminCookie, {
			clientId,
			title: "Bad",
			type: "FREE",
			slug: "Not A Slug",
		});

		expect(badSlug.statusCode).toBe(400);

		const unknownClient = await createAlbum(adminCookie, {
			clientId: "00000000-0000-4000-8000-000000000042",
			title: "Nope",
			type: "FREE",
		});

		expect(unknownClient.statusCode).toBe(404);

		const unknownCover = await createAlbum(adminCookie, {
			clientId,
			title: "Cover",
			type: "FREE",
			coverPhotoId: "00000000-0000-4000-8000-000000000042",
		});

		expect(unknownCover.statusCode).toBe(404);

		const second = await createAlbum(adminCookie, { clientId, title: "After hours", type: "PAID" });

		expect(second.statusCode).toBe(201);

		const list = await app.inject({
			method: "GET",
			url: "/v1/albums",
			headers: { cookie: adminCookie },
		});

		expect(list.json().total).toBe(3);
		expect(list.json().items.map((album: { title: string }) => album.title).sort())
			.toEqual(["After hours", "Fixed", "The city, slowly"]);

		const filtered = await app.inject({
			method: "GET",
			url: `/v1/albums?clientId=${clientId}&type=WATERMARK`,
			headers: { cookie: adminCookie },
		});

		expect(filtered.json().total).toBe(1);
		expect(filtered.json().items[0].title).toBe("The city, slowly");
	});

	it("updates albums but keeps the slug immutable", async () => {
		const created = await createAlbum(adminCookie, { clientId, title: "Quiet things", type: "FREE" });
		const id = created.json().id as string;

		const patched = await app.inject({
			method: "PATCH",
			url: `/v1/albums/${id}`,
			headers: { cookie: assistantCookie },
			payload: { title: "Quieter things", description: "Edit", expiresAt: "2030-01-01T00:00:00Z" },
		});

		expect(patched.statusCode).toBe(200);
		expect(patched.json().title).toBe("Quieter things");
		expect(patched.json().expiresAt).toBe("2030-01-01T00:00:00.000Z");
		expect(auditActions(mock)).toContain("albums.update");

		const slugAttempt = await app.inject({
			method: "PATCH",
			url: `/v1/albums/${id}`,
			headers: { cookie: adminCookie },
			payload: { slug: "renamed" },
		});

		expect(slugAttempt.statusCode).toBe(400);

		const nullClear = await app.inject({
			method: "PATCH",
			url: `/v1/albums/${id}`,
			headers: { cookie: adminCookie },
			payload: { description: null, expiresAt: null },
		});

		expect(nullClear.statusCode).toBe(200);
		expect(nullClear.json().description).toBe(null);
		expect(nullClear.json().expiresAt).toBe(null);
	});
});

describe("album photo membership", () => {
	it("replaces ordered membership densely, dedupes and tracks the cover photo", async () => {
		const first = seedPhoto("originals/a.jpg");
		const second = seedPhoto("originals/b.jpg");
		const created = await createAlbum(adminCookie, { clientId, title: "Members", type: "FREE" });
		const id = created.json().id as string;

		const unknown = await app.inject({
			method: "PUT",
			url: `/v1/albums/${id}/photos`,
			headers: { cookie: adminCookie },
			payload: { photoIds: ["00000000-0000-4000-8000-000000000042"] },
		});

		expect(unknown.statusCode).toBe(400);

		const withCover = await app.inject({
			method: "PATCH",
			url: `/v1/albums/${id}`,
			headers: { cookie: adminCookie },
			payload: { coverPhotoId: first },
		});

		expect(withCover.json().coverPhotoId).toBe(first);

		const replaced = await app.inject({
			method: "PUT",
			url: `/v1/albums/${id}/photos`,
			headers: { cookie: photographerCookie },
			payload: { photoIds: [second, first, second] },
		});

		expect(replaced.statusCode).toBe(200);
		expect(replaced.json().photoIds).toEqual([second, first]);
		expect(auditActions(mock)).toContain("albums.photos.set");

		const positions = mock.albumPhoto.rows
			.filter((row) => row.albumId === id)
			.map((row) => row.position)
			.sort();

		expect(positions).toEqual([1, 2]);

		const coverHidden = await app.inject({
			method: "PUT",
			url: `/v1/albums/${id}/photos`,
			headers: { cookie: adminCookie },
			payload: { photoIds: [second] },
		});

		expect(coverHidden.json().coverPhotoId).toBe(null);
		expect(coverHidden.json().photoIds).toEqual([second]);

		const toggled = await app.inject({
			method: "PATCH",
			url: `/v1/albums/${id}/photos/${second}`,
			headers: { cookie: adminCookie },
			payload: { isPreview: false },
		});

		expect(toggled.statusCode).toBe(200);
		expect(mock.albumPhoto.rows.find((row) => row.photoId === second)?.isPreview).toBe(false);

		const notMember = await app.inject({
			method: "PATCH",
			url: `/v1/albums/${id}/photos/${first}`,
			headers: { cookie: adminCookie },
			payload: { isPreview: false },
		});

		expect(notMember.statusCode).toBe(404);
	});
});

describe("album publishing and access codes", () => {
	it("requires codes for WATERMARK/PAID publishing and rotates links", async () => {
		const paid = await createAlbum(adminCookie, { clientId, title: "Edition", type: "PAID", priceCents: 90_000 });
		const id = paid.json().id as string;

		const blocked = await app.inject({
			method: "POST",
			url: `/v1/albums/${id}/publish`,
			headers: { cookie: adminCookie },
		});

		expect(blocked.statusCode).toBe(400);

		const weakCode = await app.inject({
			method: "POST",
			url: `/v1/albums/${id}/access-code`,
			headers: { cookie: adminCookie },
			payload: { code: "12" },
		});

		expect(weakCode.statusCode).toBe(400);

		const coded = await app.inject({
			method: "POST",
			url: `/v1/albums/${id}/access-code`,
			headers: { cookie: photographerCookie },
			payload: { code: "AB12CD" },
		});

		expect(coded.statusCode).toBe(200);
		expect(coded.json()).toEqual({ status: "set" });
		expect(auditActions(mock)).toContain("albums.access.set");

		const detail = await app.inject({
			method: "GET",
			url: `/v1/albums/${id}`,
			headers: { cookie: adminCookie },
		});

		expect(detail.json().hasAccessCode).toBe(true);
		expect("accessCodeHash" in detail.json()).toBe(false);

		const published = await app.inject({
			method: "POST",
			url: `/v1/albums/${id}/publish`,
			headers: { cookie: adminCookie },
		});

		expect(published.statusCode).toBe(200);
		expect(published.json().status).toBe("PUBLISHED");
		expect(published.json().publishedAt).not.toBe(null);
		expect(auditActions(mock)).toContain("albums.publish");

		const repeat = await app.inject({
			method: "POST",
			url: `/v1/albums/${id}/publish`,
			headers: { cookie: adminCookie },
		});

		expect(repeat.statusCode).toBe(400);

		const clearWhilePublished = await app.inject({
			method: "DELETE",
			url: `/v1/albums/${id}/access-code`,
			headers: { cookie: adminCookie },
		});

		expect(clearWhilePublished.statusCode).toBe(400);

		const rotated = await app.inject({
			method: "POST",
			url: `/v1/albums/${id}/rotate`,
			headers: { cookie: adminCookie },
		});

		expect(rotated.statusCode).toBe(200);
		expect(rotated.json()).toEqual({ status: "rotated", secretVersion: 2 });
		expect(auditActions(mock)).toContain("albums.rotate");

		const unpublished = await app.inject({
			method: "POST",
			url: `/v1/albums/${id}/unpublish`,
			headers: { cookie: editorCookie },
		});

		expect(unpublished.statusCode).toBe(403);

		const unpublishedByAdmin = await app.inject({
			method: "POST",
			url: `/v1/albums/${id}/unpublish`,
			headers: { cookie: adminCookie },
		});

		expect(unpublishedByAdmin.statusCode).toBe(200);
		expect(unpublishedByAdmin.json().status).toBe("DRAFT");
		expect(unpublishedByAdmin.json().publishedAt).toBe(null);
		expect(auditActions(mock)).toContain("albums.unpublish");

		const cleared = await app.inject({
			method: "DELETE",
			url: `/v1/albums/${id}/access-code`,
			headers: { cookie: adminCookie },
		});

		expect(cleared.statusCode).toBe(200);
		expect(cleared.json()).toEqual({ status: "cleared" });
	});

	it("publishes FREE albums without a code", async () => {
		const free = await createAlbum(adminCookie, { clientId, title: "Free set", type: "FREE" });
		const id = free.json().id as string;

		const published = await app.inject({
			method: "POST",
			url: `/v1/albums/${id}/publish`,
			headers: { cookie: assistantCookie },
		});

		expect(published.statusCode).toBe(200);
		expect(published.json().status).toBe("PUBLISHED");
	});
});

describe("album archive and permission matrix", () => {
	it("archives instead of deleting and hides archived albums by default", async () => {
		const created = await createAlbum(adminCookie, { clientId, title: "Old work", type: "FREE" });
		const id = created.json().id as string;

		const archived = await app.inject({
			method: "DELETE",
			url: `/v1/albums/${id}`,
			headers: { cookie: adminCookie },
		});

		expect(archived.statusCode).toBe(200);
		expect(archived.json()).toEqual({ status: "archived" });
		expect(auditActions(mock)).toContain("albums.archive");

		const again = await app.inject({
			method: "DELETE",
			url: `/v1/albums/${id}`,
			headers: { cookie: adminCookie },
		});

		expect(again.statusCode).toBe(409);

		const defaultList = await app.inject({
			method: "GET",
			url: "/v1/albums",
			headers: { cookie: adminCookie },
		});

		expect(defaultList.json().total).toBe(0);

		const archivedList = await app.inject({
			method: "GET",
			url: "/v1/albums?status=ARCHIVED",
			headers: { cookie: adminCookie },
		});

		expect(archivedList.json().total).toBe(1);
		expect(archivedList.json().items[0].id).toBe(id);

		const archivedPublish = await app.inject({
			method: "POST",
			url: `/v1/albums/${id}/publish`,
			headers: { cookie: adminCookie },
		});

		expect(archivedPublish.statusCode).toBe(400);
	});

	it("enforces the albums permission matrix", async () => {
		const anonymous = await app.inject({ method: "GET", url: "/v1/albums" });

		expect(anonymous.statusCode).toBe(401);

		const accountantRead = await app.inject({
			method: "GET",
			url: "/v1/albums",
			headers: { cookie: accountantCookie },
		});

		expect(accountantRead.statusCode).toBe(403);

		const editorWrite = await createAlbum(editorCookie, { clientId, title: "Nope", type: "FREE" });

		expect(editorWrite.statusCode).toBe(403);
		expect(editorWrite.json().error.code).toBe("AUTHORIZATION_ERROR");

		const editorRead = await app.inject({
			method: "GET",
			url: "/v1/albums",
			headers: { cookie: editorCookie },
		});

		expect(editorRead.statusCode).toBe(200);

		const assistantCreate = await createAlbum(assistantCookie, { clientId, title: "Assistant", type: "FREE" });

		expect(assistantCreate.statusCode).toBe(201);

		const photographerCreate = await createAlbum(photographerCookie, { clientId, title: "Shooter", type: "FREE" });

		expect(photographerCreate.statusCode).toBe(201);
	});
});

describe("album tag assignment", () => {
	let albumId = "";
	let tagId = "";

	beforeEach(async () => {
		const admin = await seedUser(mock, { email: "admin@test.com", role: "ADMIN" });
		const adminC = sessionCookie(await seedSession(mock, admin.id));

		const client = await app.inject({
			method: "POST",
			url: "/v1/clients",
			headers: { cookie: adminC },
			payload: { name: "Test Client", email: "test@example.com" },
		});
		clientId = client.json().id;

		const album = await app.inject({
			method: "POST",
			url: "/v1/albums",
			headers: { cookie: adminC },
			payload: { clientId, title: "Test Album", type: "FREE" },
		});
		albumId = album.json().id;

		const tag = mock.tag.create({
			data: { name: "Wedding", slug: "wedding", status: "ACTIVE", visibility: "PUBLIC" },
		}) as { id: string };
		tagId = tag.id;
	});

	it("assigns and removes a tag", async () => {
		const add = await app.inject({
			method: "POST",
			url: `/v1/albums/${albumId}/tags/${tagId}`,
			headers: { cookie: adminCookie },
		});
		expect(add.statusCode).toBe(200);
		expect(add.json()).toEqual({ status: "added" });
		expect(auditActions(mock)).toContain("albums.tags.add");

		const duplicate = await app.inject({
			method: "POST",
			url: `/v1/albums/${albumId}/tags/${tagId}`,
			headers: { cookie: adminCookie },
		});
		expect(duplicate.statusCode).toBe(200);

		const remove = await app.inject({
			method: "DELETE",
			url: `/v1/albums/${albumId}/tags/${tagId}`,
			headers: { cookie: adminCookie },
		});
		expect(remove.statusCode).toBe(200);
		expect(remove.json()).toEqual({ status: "removed" });
		expect(auditActions(mock)).toContain("albums.tags.remove");
	});

	it("returns 404 for unknown tag", async () => {
		const res = await app.inject({
			method: "POST",
			url: `/v1/albums/${albumId}/tags/00000000-0000-4000-8000-000000000042`,
			headers: { cookie: adminCookie },
		});
		expect(res.statusCode).toBe(404);
	});

	it("allows PHOTOGRAPHER to assign tags", async () => {
		const res = await app.inject({
			method: "POST",
			url: `/v1/albums/${albumId}/tags/${tagId}`,
			headers: { cookie: photographerCookie },
		});
		expect(res.statusCode).toBe(200);
	});

	it("allows ASSISTANT to assign tags", async () => {
		const res = await app.inject({
			method: "POST",
			url: `/v1/albums/${albumId}/tags/${tagId}`,
			headers: { cookie: assistantCookie },
		});
		expect(res.statusCode).toBe(200);
	});

	it("denies EDITOR tag assignment", async () => {
		const res = await app.inject({
			method: "POST",
			url: `/v1/albums/${albumId}/tags/${tagId}`,
			headers: { cookie: editorCookie },
		});
		expect(res.statusCode).toBe(403);
	});

	it("denies ACCOUNTANT tag assignment", async () => {
		const res = await app.inject({
			method: "POST",
			url: `/v1/albums/${albumId}/tags/${tagId}`,
			headers: { cookie: accountantCookie },
		});
		expect(res.statusCode).toBe(403);
	});
});
