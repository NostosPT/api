import "../../test/env.js";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { createMockPrisma, resetMock, resetMockIds, type MockPrisma } from "../../test/prisma-mock.js";

const holder = { prisma: createMockPrisma() };

vi.mock("../../db/prisma.js", () => ({ prisma: holder.prisma }));

import { createApp } from "../../app.js";
import { seedSession, seedUser, sessionCookie } from "../../test/helpers.js";

vi.setConfig({ testTimeout: 30_000 });

let app: FastifyInstance;
let mock: MockPrisma;
let adminCookie = "";
let editorCookie = "";
let accountantCookie = "";
let albumId = "";
let clientId = "";
let otherClientId = "";
let photoA = "";
let photoB = "";

beforeAll(async () => {
	app = await createApp();
});

beforeEach(async () => {
	resetMockIds();
	resetMock(holder.prisma);
	mock = holder.prisma;

	const admin = await seedUser(mock, { email: "admin@nostos.photos", role: "ADMIN" });
	const editor = await seedUser(mock, { email: "editor@nostos.photos", role: "EDITOR" });
	const accountant = await seedUser(mock, { email: "money@nostos.photos", role: "ACCOUNTANT" });

	adminCookie = sessionCookie(await seedSession(mock, admin.id));
	editorCookie = sessionCookie(await seedSession(mock, editor.id));
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
		payload: { clientId, title: "Delivery", type: "WATERMARK" },
	});

	albumId = album.json().id as string;

	photoA = (mock.photo.create({
		data: { originalKey: "originals/a.jpg", status: "PUBLISHED", uploadStatus: "READY", visibility: "PUBLIC", availability: "AVAILABLE", priceCents: 9000, currency: "EUR" },
	}) as { id: string }).id;
	photoB = (mock.photo.create({
		data: { originalKey: "originals/b.jpg", status: "PUBLISHED", uploadStatus: "READY", visibility: "PUBLIC", availability: "AVAILABLE", currency: "EUR" },
	}) as { id: string }).id;
});

function seedFavorite(favClientId: string, photoId: string, createdAt: Date): string {
	return (mock.favorite.create({
		data: { clientId: favClientId, albumId, photoId, createdAt },
	}) as { id: string }).id;
}

describe("album favorites for staff", () => {
	it("lists favorites newest first with photo summaries and counts", async () => {
		seedFavorite(clientId, photoA, new Date("2026-01-01T10:00:00Z"));
		seedFavorite(clientId, photoB, new Date("2026-01-02T10:00:00Z"));
		seedFavorite(otherClientId, photoA, new Date("2026-01-03T10:00:00Z"));

		const list = await app.inject({
			method: "GET",
			url: `/v1/albums/${albumId}/favorites`,
			headers: { cookie: editorCookie },
		});

		expect(list.statusCode).toBe(200);

		const body = list.json();

		expect(body.total).toBe(3);
		expect(body.page).toBe(1);
		expect(body.items[0].photoId).toBe(photoA);
		expect(body.items[0].clientId).toBe(otherClientId);
		expect(body.items[0].photo).toMatchObject({
			id: photoA,
			title: null,
			availability: "AVAILABLE",
			priceCents: 9000,
		});

		const filtered = await app.inject({
			method: "GET",
			url: `/v1/albums/${albumId}/favorites?clientId=${clientId}`,
			headers: { cookie: adminCookie },
		});

		expect(filtered.json().total).toBe(2);

		const paged = await app.inject({
			method: "GET",
			url: `/v1/albums/${albumId}/favorites?pageSize=1`,
			headers: { cookie: adminCookie },
		});

		expect(paged.json().items).toHaveLength(1);
		expect(paged.json().total).toBe(3);
	});

	it("returns an empty page for albums without favorites and 404 for unknown albums", async () => {
		const empty = await app.inject({
			method: "GET",
			url: `/v1/albums/${albumId}/favorites`,
			headers: { cookie: adminCookie },
		});

		expect(empty.statusCode).toBe(200);
		expect(empty.json()).toEqual({ items: [], page: 1, pageSize: 20, total: 0 });

		const unknown = await app.inject({
			method: "GET",
			url: "/v1/albums/00000000-0000-4000-8000-000000000042/favorites",
			headers: { cookie: adminCookie },
		});

		expect(unknown.statusCode).toBe(404);
	});

	it("follows the albums read matrix", async () => {
		const anonymous = await app.inject({
			method: "GET",
			url: `/v1/albums/${albumId}/favorites`,
		});

		expect(anonymous.statusCode).toBe(401);

		const accountant = await app.inject({
			method: "GET",
			url: `/v1/albums/${albumId}/favorites`,
			headers: { cookie: accountantCookie },
		});

		expect(accountant.statusCode).toBe(403);
	});
});
