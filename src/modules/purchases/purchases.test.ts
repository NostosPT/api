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
let otherClientId = "";
let albumId = "";
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

	const firstClient = await app.inject({
		method: "POST",
		url: "/v1/clients",
		headers: { cookie: adminCookie },
		payload: { name: "Ana Silva", email: "ana@example.com" },
	});
	const secondClient = await app.inject({
		method: "POST",
		url: "/v1/clients",
		headers: { cookie: adminCookie },
		payload: { name: "Bruno Dias", email: "bruno@example.com" },
	});

	clientId = firstClient.json().id as string;
	otherClientId = secondClient.json().id as string;

	const album = await app.inject({
		method: "POST",
		url: "/v1/albums",
		headers: { cookie: adminCookie },
		payload: { clientId, title: "Edition set", type: "PAID", priceCents: 120_000 },
	});

	albumId = album.json().id as string;

	photoA = (mock.photo.create({
		data: { originalKey: "originals/a.jpg", status: "PUBLISHED", uploadStatus: "READY", visibility: "PUBLIC", availability: "AVAILABLE", currency: "EUR" },
	}) as { id: string }).id;
	photoB = (mock.photo.create({
		data: { originalKey: "originals/b.jpg", status: "PUBLISHED", uploadStatus: "READY", visibility: "PUBLIC", availability: "AVAILABLE", currency: "EUR" },
	}) as { id: string }).id;
	photoC = (mock.photo.create({
		data: { originalKey: "originals/c.jpg", status: "PUBLISHED", uploadStatus: "READY", visibility: "PUBLIC", availability: "AVAILABLE", currency: "EUR" },
	}) as { id: string }).id;

	await app.inject({
		method: "PUT",
		url: `/v1/albums/${albumId}/photos`,
		headers: { cookie: adminCookie },
		payload: { photoIds: [photoA, photoB] },
	});
});

async function createPurchase(cookie: string, payload: Record<string, unknown>) {
	return app.inject({
		method: "POST",
		url: "/v1/purchases",
		headers: { cookie },
		payload,
	});
}

describe("purchase creation and scope validation", () => {
	it("creates PHOTO and PACK purchases bound to the album's client and membership", async () => {
		const photoPurchase = await createPurchase(adminCookie, {
			clientId,
			albumId,
			scope: "PHOTO",
			photoId: photoA,
			priceCents: 9000,
		});

		expect(photoPurchase.statusCode).toBe(201);
		expect(photoPurchase.json().status).toBe("PENDING");
		expect(photoPurchase.json().items).toHaveLength(1);
		expect(photoPurchase.json().items[0].photoId).toBe(photoA);
		expect(auditActions(mock)).toContain("purchase.create");

		const missingPhotoId = await createPurchase(adminCookie, {
			clientId,
			albumId,
			scope: "PHOTO",
			priceCents: 9000,
		});

		expect(missingPhotoId.statusCode).toBe(400);

		const nonMember = await createPurchase(adminCookie, {
			clientId,
			albumId,
			scope: "PHOTO",
			photoId: photoC,
			priceCents: 9000,
		});

		expect(nonMember.statusCode).toBe(400);

		const pack = await createPurchase(adminCookie, {
			clientId,
			albumId,
			scope: "PACK",
			packPhotoIds: [photoB, photoA, photoB],
			priceCents: 15000,
		});

		expect(pack.statusCode).toBe(201);
		expect(pack.json().items).toHaveLength(2);

		const packNonMember = await createPurchase(adminCookie, {
			clientId,
			albumId,
			scope: "PACK",
			packPhotoIds: [photoC],
			priceCents: 15000,
		});

		expect(packNonMember.statusCode).toBe(400);

		const albumWithPhotos = await createPurchase(adminCookie, {
			clientId,
			albumId,
			scope: "ALBUM",
			photoId: photoA,
			priceCents: 120000,
		});

		expect(albumWithPhotos.statusCode).toBe(400);

		const wrongClient = await createPurchase(adminCookie, {
			clientId: otherClientId,
			albumId,
			scope: "ALBUM",
			priceCents: 120000,
		});

		expect(wrongClient.statusCode).toBe(400);

		const unknownAlbum = await createPurchase(adminCookie, {
			clientId,
			albumId: "00000000-0000-4000-8000-000000000042",
			scope: "ALBUM",
			priceCents: 120000,
		});

		expect(unknownAlbum.statusCode).toBe(404);

		const unknownClient = await createPurchase(adminCookie, {
			clientId: "00000000-0000-4000-8000-000000000042",
			albumId,
			scope: "ALBUM",
			priceCents: 120000,
		});

		expect(unknownClient.statusCode).toBe(404);
	});
});

describe("purchase status transitions", () => {
	it("completes with an album membership snapshot and enforces legal transitions", async () => {
		const created = await createPurchase(adminCookie, {
			clientId,
			albumId,
			scope: "ALBUM",
			priceCents: 120000,
			note: "bank transfer",
		});
		const id = created.json().id as string;

		expect(created.json().items).toEqual([]);

		const completed = await app.inject({
			method: "PATCH",
			url: `/v1/purchases/${id}`,
			headers: { cookie: assistantCookie },
			payload: { status: "COMPLETED" },
		});

		expect(completed.statusCode).toBe(200);
		expect(completed.json().status).toBe("COMPLETED");
		expect(completed.json().completedAt).not.toBe(null);
		expect(completed.json().items.map((item: { photoId: string }) => item.photoId)).toEqual([photoA, photoB]);
		expect(auditActions(mock)).toContain("purchase.complete");

		const completedAgain = await app.inject({
			method: "PATCH",
			url: `/v1/purchases/${id}`,
			headers: { cookie: adminCookie },
			payload: { status: "COMPLETED" },
		});

		expect(completedAgain.statusCode).toBe(400);

		const refunded = await app.inject({
			method: "PATCH",
			url: `/v1/purchases/${id}`,
			headers: { cookie: adminCookie },
			payload: { status: "REFUNDED" },
		});

		expect(refunded.statusCode).toBe(200);
		expect(refunded.json().status).toBe("REFUNDED");
		expect(auditActions(mock)).toContain("purchase.refund");

		const refundTwice = await app.inject({
			method: "PATCH",
			url: `/v1/purchases/${id}`,
			headers: { cookie: adminCookie },
			payload: { status: "REFUNDED" },
		});

		expect(refundTwice.statusCode).toBe(400);

		const noteOnly = await app.inject({
			method: "PATCH",
			url: `/v1/purchases/${id}`,
			headers: { cookie: adminCookie },
			payload: { note: "receipt sent" },
		});

		expect(noteOnly.statusCode).toBe(200);
		expect(noteOnly.json().note).toBe("receipt sent");
		expect(auditActions(mock)).toContain("purchase.update");

		const failed = await createPurchase(adminCookie, {
			clientId,
			albumId,
			scope: "PHOTO",
			photoId: photoA,
			priceCents: 9000,
		});
		const failedId = failed.json().id as string;

		const failedPatch = await app.inject({
			method: "PATCH",
			url: `/v1/purchases/${failedId}`,
			headers: { cookie: adminCookie },
			payload: { status: "FAILED" },
		});

		expect(failedPatch.statusCode).toBe(200);
		expect(auditActions(mock)).toContain("purchase.fail");

		const failedToCompleted = await app.inject({
			method: "PATCH",
			url: `/v1/purchases/${failedId}`,
			headers: { cookie: adminCookie },
			payload: { status: "COMPLETED" },
		});

		expect(failedToCompleted.statusCode).toBe(400);
	});

	it("materializes ALBUM membership on completion with one bulk insert", async () => {
		const created = await createPurchase(adminCookie, { clientId, albumId, scope: "ALBUM", priceCents: 120000 });
		const id = created.json().id as string;
		const createMany = vi.spyOn(mock.purchasePhoto, "createMany");
		const create = vi.spyOn(mock.purchasePhoto, "create");

		const completed = await app.inject({
			method: "PATCH",
			url: `/v1/purchases/${id}`,
			headers: { cookie: adminCookie },
			payload: { status: "COMPLETED" },
		});

		expect(completed.statusCode).toBe(200);
		expect(completed.json().items.map((item: { photoId: string }) => item.photoId)).toEqual([photoA, photoB]);
		expect(createMany).toHaveBeenCalledTimes(1);
		expect(create).not.toHaveBeenCalled();

		createMany.mockRestore();
		create.mockRestore();
	});
});

describe("purchase listing and permission matrix", () => {
	it("filters purchases and serves detail with items", async () => {
		const first = await createPurchase(adminCookie, {
			clientId,
			albumId,
			scope: "PHOTO",
			photoId: photoA,
			priceCents: 9000,
		});
		const second = await createPurchase(adminCookie, {
			clientId,
			albumId,
			scope: "ALBUM",
			priceCents: 120000,
		});

		await app.inject({
			method: "PATCH",
			url: `/v1/purchases/${second.json().id as string}`,
			headers: { cookie: adminCookie },
			payload: { status: "COMPLETED" },
		});

		const all = await app.inject({
			method: "GET",
			url: "/v1/purchases",
			headers: { cookie: accountantCookie },
		});

		expect(all.statusCode).toBe(200);
		expect(all.json().total).toBe(2);

		const pending = await app.inject({
			method: "GET",
			url: "/v1/purchases?status=PENDING",
			headers: { cookie: adminCookie },
		});

		expect(pending.json().total).toBe(1);
		expect(pending.json().items[0].id).toBe(first.json().id);

		const byScope = await app.inject({
			method: "GET",
			url: "/v1/purchases?scope=ALBUM",
			headers: { cookie: adminCookie },
		});

		expect(byScope.json().total).toBe(1);

		const byClient = await app.inject({
			method: "GET",
			url: `/v1/purchases?clientId=${otherClientId}`,
			headers: { cookie: adminCookie },
		});

		expect(byClient.json().total).toBe(0);

		const detail = await app.inject({
			method: "GET",
			url: `/v1/purchases/${first.json().id as string}`,
			headers: { cookie: adminCookie },
		});

		expect(detail.statusCode).toBe(200);
		expect(detail.json().items).toHaveLength(1);

		const unknown = await app.inject({
			method: "GET",
			url: "/v1/purchases/00000000-0000-4000-8000-000000000042",
			headers: { cookie: adminCookie },
		});

		expect(unknown.statusCode).toBe(404);
	});

	it("follows the derived CRM matrix for purchases", async () => {
		const anonymous = await app.inject({ method: "GET", url: "/v1/purchases" });

		expect(anonymous.statusCode).toBe(401);

		const editorRead = await app.inject({
			method: "GET",
			url: "/v1/purchases",
			headers: { cookie: editorCookie },
		});

		expect(editorRead.statusCode).toBe(403);

		const photographerRead = await app.inject({
			method: "GET",
			url: "/v1/purchases",
			headers: { cookie: photographerCookie },
		});

		expect(photographerRead.statusCode).toBe(200);

		const photographerWrite = await createPurchase(photographerCookie, {
			clientId,
			albumId,
			scope: "ALBUM",
			priceCents: 120000,
		});

		expect(photographerWrite.statusCode).toBe(403);

		const accountantWrite = await createPurchase(accountantCookie, {
			clientId,
			albumId,
			scope: "ALBUM",
			priceCents: 120000,
		});

		expect(accountantWrite.statusCode).toBe(403);

		const assistantCreate = await createPurchase(assistantCookie, {
			clientId,
			albumId,
			scope: "ALBUM",
			priceCents: 120000,
		});

		expect(assistantCreate.statusCode).toBe(201);

		const completed = await app.inject({
			method: "PATCH",
			url: `/v1/purchases/${assistantCreate.json().id as string}`,
			headers: { cookie: assistantCookie },
			payload: { status: "COMPLETED" },
		});

		expect(completed.statusCode).toBe(200);
	});
});
