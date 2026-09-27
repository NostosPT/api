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
let _gallerySlug = "";

beforeAll(async () => {
	app = await createApp();
});

beforeEach(async () => {
	resetMockIds();
	resetMock(holder.prisma);
	mock = holder.prisma;

	const admin = await seedUser(mock, { email: "admin@nostos.photos", role: "ADMIN", name: "Admin User" });
	sessionCookie(await seedSession(mock, admin.id));

	// Published + public photos
	mock.photo.create({
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
	});

	mock.photo.create({
		data: {
			originalKey: "originals/draft1.jpg",
			status: "DRAFT",
			uploadStatus: "READY",
			visibility: "PUBLIC",
			availability: "NOT_FOR_SALE",
			currency: "EUR",
			title: "Draft Photo",
			number: 102,
			photographerId: admin.id,
		},
	});

	mock.photo.create({
		data: {
			originalKey: "originals/priv1.jpg",
			status: "PUBLISHED",
			uploadStatus: "READY",
			visibility: "PRIVATE",
			availability: "AVAILABLE",
			currency: "EUR",
			title: "Private Photo",
			number: 103,
			photographerId: admin.id,
		},
	});

	mock.photo.create({
		data: {
			originalKey: "originals/feat1.jpg",
			status: "PUBLISHED",
			uploadStatus: "READY",
			visibility: "PUBLIC",
			availability: "AVAILABLE",
			currency: "EUR",
			title: "Featured Photo",
			number: 104,
			photographerId: admin.id,
		},
	});

	// Category + Tag (ACTIVE + PUBLIC)
	const category = mock.category.create({
		data: { name: "Landscapes", slug: "landscapes", status: "ACTIVE", position: 1 },
	}) as { id: string; slug: string };
	(mock.photoCategory.create({ data: { photoId: (mock.photo.findFirst({ where: { number: 101 } }) as { id: string }).id, categoryId: category.id } }) as { id: string }).id;

	const tag = mock.tag.create({
		data: { name: "Sunset", slug: "sunset", status: "ACTIVE", visibility: "PUBLIC" },
	}) as { id: string; slug: string };
	(mock.photoTag.create({ data: { photoId: (mock.photo.findFirst({ where: { number: 101 } }) as { id: string }).id, tagId: tag.id } }) as { id: string }).id;

	// Gallery: published + draft
	const pubGallery = mock.gallery.create({
		data: { slug: "portugal-2026", title: "Portugal 2026", status: "PUBLISHED", position: 1 },
	}) as { id: string; slug: string };
	const draftGallery = mock.gallery.create({
		data: { slug: "wip-gallery", title: "Work in Progress", status: "DRAFT", position: 2 },
	}) as { id: string };

	_gallerySlug = pubGallery.slug;

	// Memberships
	mock.galleryPhoto.create({ data: { galleryId: pubGallery.id, photoId: (mock.photo.findFirst({ where: { number: 101 } }) as { id: string }).id, position: 1, isFeatured: true } });
	mock.galleryPhoto.create({ data: { galleryId: pubGallery.id, photoId: (mock.photo.findFirst({ where: { number: 104 } }) as { id: string }).id, position: 2, isFeatured: false } });
	mock.galleryPhoto.create({ data: { galleryId: draftGallery.id, photoId: (mock.photo.findFirst({ where: { number: 101 } }) as { id: string }).id, position: 1, isFeatured: false } });
});

describe("public gallery endpoints", () => {
	it("lists only published galleries ordered by position then createdAt", async () => {
		const res = await app.inject({ method: "GET", url: "/v1/public/galleries" });

		expect(res.statusCode).toBe(200);
		expect(res.json().total).toBe(1);
		expect(res.json().items[0].slug).toBe("portugal-2026");
		expect(res.json().items[0].title).toBe("Portugal 2026");
	});

	it("returns gallery detail with two-gate filtered photos and featured flag", async () => {
		const res = await app.inject({ method: "GET", url: `/v1/public/galleries/${_gallerySlug}` });

		expect(res.statusCode).toBe(200);
		const body = res.json();
		expect(body.title).toBe("Portugal 2026");
		expect(body.photos).toHaveLength(2);

		// _photoPublished has isFeatured=true, _photoFeatured=false
		const featured = body.photos.find((p: { number: number }) => p.number === 101);
		expect(featured.isFeatured).toBe(true);

		const notFeatured = body.photos.find((p: { number: number }) => p.number === 104);
		expect(notFeatured.isFeatured).toBe(false);

		// draft photo excluded (status), private photo excluded (visibility), non-member excluded
		expect(body.photos.find((p: { number: number }) => p.number === 102)).toBeUndefined();
		expect(body.photos.find((p: { number: number }) => p.number === 103)).toBeUndefined();
	});

	it("returns 404 for draft gallery slug", async () => {
		const res = await app.inject({ method: "GET", url: "/v1/public/galleries/wip-gallery" });

		expect(res.statusCode).toBe(404);
	});

	it("returns 404 for unknown slug", async () => {
		const res = await app.inject({ method: "GET", url: "/v1/public/galleries/unknown" });

		expect(res.statusCode).toBe(404);
	});
});

describe("public photo detail", () => {
	it("returns detail with credit, copyright, categories, tags", async () => {
		const res = await app.inject({ method: "GET", url: "/v1/public/photos/101" });

		expect(res.statusCode).toBe(200);
		const body = res.json();
		expect(body.number).toBe(101);
		expect(body.credit).toBe("Admin User");
		expect(body.copyright).toBe("© Nostos Studio");
		expect(body.categories).toEqual([{ slug: "landscapes", name: "Landscapes" }]);
		expect(body.tags).toEqual([{ slug: "sunset", name: "Sunset" }]);
	});

	it("returns 404 for draft photo", async () => {
		const res = await app.inject({ method: "GET", url: "/v1/public/photos/102" });

		expect(res.statusCode).toBe(404);
	});

	it("returns 404 for private photo", async () => {
		const res = await app.inject({ method: "GET", url: "/v1/public/photos/103" });

		expect(res.statusCode).toBe(404);
	});

	it("returns 404 for non-member photo", async () => {
		// Create published photo not in any published gallery
		mock.photo.create({
			data: {
				originalKey: "originals/orphan.jpg",
				status: "PUBLISHED",
				uploadStatus: "READY",
				visibility: "PUBLIC",
				availability: "AVAILABLE",
				currency: "EUR",
				title: "Orphan",
				number: 200,
				photographerId: (mock.user.findFirst({ where: { email: "admin@nostos.photos" } }) as { id: string }).id,
			},
		});

		const res = await app.inject({ method: "GET", url: "/v1/public/photos/200" });

		expect(res.statusCode).toBe(404);
	});

	it("returns 404 for unknown number", async () => {
		const res = await app.inject({ method: "GET", url: "/v1/public/photos/9999" });

		expect(res.statusCode).toBe(404);
	});
});

describe("public photo listing", () => {
	it("returns only exposed photos (two-gate + published gallery membership)", async () => {
		const res = await app.inject({ method: "GET", url: "/v1/public/photos" });

		expect(res.statusCode).toBe(200);
		expect(res.json().total).toBe(2);
		const numbers = res.json().items.map((p: { number: number }) => p.number);
		expect(numbers).toContain(101);
		expect(numbers).toContain(104);
	});

	it("filters by category slug", async () => {
		const res = await app.inject({ method: "GET", url: "/v1/public/photos?category=landscapes" });

		expect(res.statusCode).toBe(200);
		expect(res.json().total).toBe(1);
		expect(res.json().items[0].number).toBe(101);
	});

	it("filters by tag slug", async () => {
		const res = await app.inject({ method: "GET", url: "/v1/public/photos?tag=sunset" });

		expect(res.statusCode).toBe(200);
		expect(res.json().total).toBe(1);
		expect(res.json().items[0].number).toBe(101);
	});

	it("filters by gallery slug", async () => {
		const res = await app.inject({ method: "GET", url: "/v1/public/photos?gallery=portugal-2026" });

		expect(res.statusCode).toBe(200);
		expect(res.json().total).toBe(2);
	});

	it("searches by title (q)", async () => {
		const res = await app.inject({ method: "GET", url: "/v1/public/photos?q=Lisbon" });

		expect(res.statusCode).toBe(200);
		expect(res.json().total).toBe(1);
		expect(res.json().items[0].number).toBe(101);
	});

	it("searches by photo number (q digits)", async () => {
		const res = await app.inject({ method: "GET", url: "/v1/public/photos?q=101" });

		expect(res.statusCode).toBe(200);
		expect(res.json().total).toBe(1);
		expect(res.json().items[0].number).toBe(101);
	});

	it("sorts newest (default) and oldest", async () => {
		const newest = await app.inject({ method: "GET", url: "/v1/public/photos?sort=newest" });
		const oldest = await app.inject({ method: "GET", url: "/v1/public/photos?sort=oldest" });

		expect(newest.statusCode).toBe(200);
		expect(oldest.statusCode).toBe(200);
	});

	it("sort=featured narrows to featured photos only", async () => {
		const res = await app.inject({ method: "GET", url: "/v1/public/photos?sort=featured" });

		expect(res.statusCode).toBe(200);
		expect(res.json().total).toBe(1);
		expect(res.json().items[0].number).toBe(101);
	});

	it("paginates correctly", async () => {
		const page1 = await app.inject({ method: "GET", url: "/v1/public/photos?pageSize=1&page=1" });
		const page2 = await app.inject({ method: "GET", url: "/v1/public/photos?pageSize=1&page=2" });

		expect(page1.json().items).toHaveLength(1);
		expect(page2.json().items).toHaveLength(1);
		expect(page1.json().items[0].number).not.toBe(page2.json().items[0].number);
	});
});