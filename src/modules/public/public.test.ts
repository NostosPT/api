import "../../test/env.js";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { createMockPrisma, resetMock, resetMockIds, type MockPrisma } from "../../test/prisma-mock.js";

const holder = { prisma: createMockPrisma() };

vi.mock("../../db/prisma.js", () => ({ prisma: holder.prisma }));

import { createApp } from "../../app.js";
import { seedUser } from "../../test/helpers.js";
import { config } from "../../config/index.js";
import { createCapabilityToken } from "../../lib/capability.js";
import { hashPassword } from "../../auth/password.js";

vi.setConfig({ testTimeout: 30_000 });

let app: FastifyInstance;
let mock: MockPrisma;

let _freeAlbumSlug = "";
let _paidAlbumSlug = "";
let _freeAlbumId = "";
let _paidAlbumId = "";
let _capabilityToken = "";
let _paidCapabilityToken = "";
let _capabilityExp = 0;
let _draftAlbumSlug = "";
let _draftAlbumId = "";
let _expiredAlbumSlug = "";
let _expiredAlbumId = "";
let _waterMarkAlbumId = "";
let _waterMarkAlbumSlug = "";
let _photoPublishedId = "";

beforeAll(async () => {
	app = await createApp();
});

beforeEach(async () => {
	resetMockIds();
	resetMock(holder.prisma);
	mock = holder.prisma;

	const admin = await seedUser(mock, { email: "admin@test.com", role: "ADMIN", name: "Admin User" });

	// Published + public photos for album tests
	_photoPublishedId = (mock.photo.create({
		data: {
			originalKey: "originals/pub1.jpg",
			status: "PUBLISHED",
			uploadStatus: "READY",
			visibility: "PUBLIC",
			availability: "AVAILABLE",
			currency: "EUR",
			title: "Lisbon Sunset",
			description: "Golden hour at Belém",
			number: 101,
			width: 4000,
			height: 3000,
			takenAt: new Date("2024-05-15T18:30:00Z"),
			location: "Lisbon, Portugal",
			priceCents: 5000,
			photographerId: admin.id,
		},
	}) as { id: string }).id;

	const _photoPreviewId = (mock.photo.create({
		data: {
			originalKey: "originals/preview1.jpg",
			status: "PUBLISHED",
			uploadStatus: "READY",
			visibility: "PUBLIC",
			availability: "AVAILABLE",
			currency: "EUR",
			title: "Preview Photo",
			number: 102,
			photographerId: admin.id,
		},
	}) as { id: string }).id;

	const _photoLockedId = (mock.photo.create({
		data: {
			originalKey: "originals/locked1.jpg",
			status: "PUBLISHED",
			uploadStatus: "READY",
			visibility: "PUBLIC",
			availability: "AVAILABLE",
			currency: "EUR",
			title: "Locked Photo",
			number: 103,
			photographerId: admin.id,
		},
	}) as { id: string }).id;

	// Create FREE album
	const freeAlbum = mock.album.create({
		data: { slug: "free-album-2026", title: "Free Album", status: "PUBLISHED", type: "FREE", secretVersion: 1 },
	}) as { id: string; slug: string };
	_freeAlbumId = freeAlbum.id;
	_freeAlbumSlug = freeAlbum.slug;
	mock.albumPhoto.create({ data: { albumId: freeAlbum.id, photoId: _photoPublishedId, position: 1, isPreview: true } });

	// Create PAID album with access code
	const paidAlbum = mock.album.create({
		data: { slug: "paid-album-2026", title: "Paid Album", status: "PUBLISHED", type: "PAID", secretVersion: 1, accessCodeHash: await hashPassword("secret123") },
	}) as { id: string; slug: string };
	_paidAlbumId = paidAlbum.id;
	_paidAlbumSlug = paidAlbum.slug;
	mock.albumPhoto.create({ data: { albumId: paidAlbum.id, photoId: _photoPreviewId, position: 1, isPreview: true } });
	mock.albumPhoto.create({ data: { albumId: paidAlbum.id, photoId: _photoLockedId, position: 2, isPreview: false } });

	// Create WATERMARK album with access code
	const waterMarkAlbum = mock.album.create({
		data: { slug: "watermark-album-2026", title: "Watermark Album", status: "PUBLISHED", type: "WATERMARK", secretVersion: 1, accessCodeHash: await hashPassword("watermark456") },
	}) as { id: string; slug: string };
	_waterMarkAlbumId = waterMarkAlbum.id;
	_waterMarkAlbumSlug = waterMarkAlbum.slug;
	mock.albumPhoto.create({ data: { albumId: waterMarkAlbum.id, photoId: _photoPublishedId, position: 1, isPreview: true } });
	mock.albumPhoto.create({ data: { albumId: waterMarkAlbum.id, photoId: _photoLockedId, position: 2, isPreview: false } });

	// Create draft album
	const draftAlbum = mock.album.create({
		data: { slug: "draft-album", title: "Draft Album", status: "DRAFT", type: "FREE", secretVersion: 1 },
	}) as { id: string; slug: string };
	_draftAlbumId = draftAlbum.id;
	_draftAlbumSlug = draftAlbum.slug;

	// Create expired album
	const expiredAlbum = mock.album.create({
		data: {
			slug: "expired-album",
			title: "Expired Album",
			status: "PUBLISHED",
			type: "FREE",
			secretVersion: 1,
			expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
		},
	}) as { id: string; slug: string };
	_expiredAlbumId = expiredAlbum.id;
	_expiredAlbumSlug = expiredAlbum.slug;

	// Generate capability tokens
	_capabilityExp = Math.floor((Date.now() + 24 * 60 * 60 * 1000) / 1000);
	_capabilityToken = createCapabilityToken(config.env.COOKIE_SECRET, _freeAlbumId, 1, _capabilityExp);
	_paidCapabilityToken = createCapabilityToken(config.env.COOKIE_SECRET, _paidAlbumId, 1, _capabilityExp);
	_capabilityExp = Math.floor((Date.now() + 24 * 60 * 60 * 1000) / 1000);
});

describe("public album access", () => {
	it("valid FREE album capability grants access", async () => {
		const res = await app.inject({
			method: "GET",
			url: `/v1/public/albums/${_freeAlbumSlug}?a=${_capabilityToken}&exp=${_capabilityExp}`,
		});

		expect(res.statusCode).toBe(200);
		expect(res.json().title).toBe("Free Album");
		expect(res.json().type).toBe("FREE");
		expect(res.json().photos).toHaveLength(1);
		expect(res.json().photos[0].number).toBe(101);
		expect(res.json().requiresAccessCode).toBe(false);
		expect(res.json().photos[0].isLocked).toBe(false);
	});

	it("valid PAID album capability + correct code grants access", async () => {
		const res = await app.inject({
			method: "GET",
			url: `/v1/public/albums/${_paidAlbumSlug}?a=${_paidCapabilityToken}&exp=${_capabilityExp}&code=secret123`,
		});

		expect(res.statusCode).toBe(200);
		expect(res.json().title).toBe("Paid Album");
		expect(res.json().type).toBe("PAID");
		expect(res.json().photos).toHaveLength(2);
		expect(res.json().requiresAccessCode).toBe(true);

		const previewPhoto = res.json().photos.find((p: { number: number }) => p.number === 102);
		expect(previewPhoto).toBeDefined();
		expect(previewPhoto!.isLocked).toBe(false);

		const lockedPhoto = res.json().photos.find((p: { number: number }) => p.number === 103);
		expect(lockedPhoto).toBeDefined();
		expect(lockedPhoto!.isLocked).toBe(true);
	});

	it("valid WATERMARK album capability + correct code grants access", async () => {
		const wmToken = createCapabilityToken(config.env.COOKIE_SECRET, _waterMarkAlbumId, 1, _capabilityExp);
		const res = await app.inject({
			method: "GET",
			url: `/v1/public/albums/${_waterMarkAlbumSlug}?a=${wmToken}&exp=${_capabilityExp}&code=watermark456`,
		});

		expect(res.statusCode).toBe(200);
		expect(res.json().type).toBe("WATERMARK");
		expect(res.json().requiresAccessCode).toBe(true);
	});

	it("invalid capability rejected", async () => {
		// Use a valid-looking but incorrect HMAC (64 hex chars)
		const invalidToken = "0".repeat(64);
		const res = await app.inject({
			method: "GET",
			url: `/v1/public/albums/${_freeAlbumSlug}?a=${invalidToken}&exp=${_capabilityExp}`,
		});

		expect(res.statusCode).toBe(404);
	});

	it("wrong access code rejected", async () => {
		const res = await app.inject({
			method: "GET",
			url: `/v1/public/albums/${_paidAlbumSlug}?a=${_paidCapabilityToken}&exp=${_capabilityExp}&code=wrongcode`,
		});

		expect(res.statusCode).toBe(400);
		expect(res.json().error.code).toBe("VALIDATION_ERROR");
	});

	it("missing access code rejected for protected album", async () => {
		const res = await app.inject({
			method: "GET",
			url: `/v1/public/albums/${_paidAlbumSlug}?a=${_paidCapabilityToken}&exp=${_capabilityExp}`,
		});

		expect(res.statusCode).toBe(400);
		expect(res.json().error.code).toBe("VALIDATION_ERROR");
	});

	it("unpublished album rejected", async () => {
		const draftToken = createCapabilityToken(config.env.COOKIE_SECRET, _draftAlbumId, 1, _capabilityExp);
		const res = await app.inject({
			method: "GET",
			url: `/v1/public/albums/${_draftAlbumSlug}?a=${draftToken}&exp=${_capabilityExp}`,
		});

		expect(res.statusCode).toBe(404);
	});

	it("expired album rejected", async () => {
		const expiredToken = createCapabilityToken(config.env.COOKIE_SECRET, _expiredAlbumId, 1, _capabilityExp);
		const res = await app.inject({
			method: "GET",
			url: `/v1/public/albums/${_expiredAlbumSlug}?a=${expiredToken}&exp=${_capabilityExp}`,
		});

		expect(res.statusCode).toBe(404);
	});

	it("rotated secretVersion invalidates old capability", async () => {
		await mock.album.update({
			where: { id: _paidAlbumId },
			data: { secretVersion: 2 },
		});

		const res = await app.inject({
			method: "GET",
			url: `/v1/public/albums/${_paidAlbumSlug}?a=${_paidCapabilityToken}&exp=${_capabilityExp}&code=secret123`,
		});

		expect(res.statusCode).toBe(404);
	});

	it("PAID album does not expose locked photos", async () => {
		const res = await app.inject({
			method: "GET",
			url: `/v1/public/albums/${_paidAlbumSlug}?a=${_paidCapabilityToken}&exp=${_capabilityExp}&code=secret123`,
		});

		expect(res.statusCode).toBe(200);
		const lockedPhoto = res.json().photos.find((p: { number: number }) => p.number === 103);
		expect(lockedPhoto).toBeDefined();
		expect(lockedPhoto!.isLocked).toBe(true);
		expect(lockedPhoto!.isPreview).toBe(false);
	});

	it("does not return raw capability or access code in response", async () => {
		const res = await app.inject({
			method: "GET",
			url: `/v1/public/albums/${_paidAlbumSlug}?a=${_paidCapabilityToken}&exp=${_capabilityExp}&code=secret123`,
		});

		expect(res.statusCode).toBe(200);
		const body = JSON.stringify(res.json());
		expect(body).not.toContain(_capabilityToken);
		expect(body).not.toContain("secret123");
		expect(body).not.toContain("watermark456");
	});
});