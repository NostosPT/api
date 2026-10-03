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

		// no display rendition and no storage in tests: imageUrl stays null (never invented)
		expect(featured.imageUrl).toBeNull();
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
		expect(body.imageUrl).toBeNull();
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
	type Row = { id: string };

	function photoId(number: number): string {
		return (mock.photo.findFirst({ where: { number } }) as Row).id;
	}

	function numbersOf(body: { items: { number: number }[] }): number[] {
		return body.items.map((p) => p.number);
	}

	async function list(query: string): Promise<{ statusCode: number; body: { items: { number: number }[]; total: number; page: number; pageSize: number } }> {
		const res = await app.inject({ method: "GET", url: `/v1/public/photos${query}` });

		return { statusCode: res.statusCode, body: res.json() };
	}

	// Extends the shared seed: 101 and 104 sit in portugal-2026 (101 pinned as
	// featured), 102 is a draft, 103 private.
	beforeEach(() => {
		const adminId = (mock.user.findFirst({ where: { email: "admin@nostos.photos" } }) as Row).id;
		const base = {
			status: "PUBLISHED",
			uploadStatus: "READY",
			visibility: "PUBLIC",
			availability: "AVAILABLE",
			currency: "EUR",
			photographerId: adminId,
		};

		mock.photo.update({ where: { number: 101 }, data: { createdAt: new Date("2026-01-10T00:00:00Z") } });
		mock.photo.update({ where: { number: 104 }, data: { createdAt: new Date("2026-01-20T00:00:00Z") } });

		// 105: member of a second published gallery, matched by description.
		mock.photo.create({
			data: {
				...base,
				originalKey: "originals/porto.jpg",
				title: "Porto Bridge",
				description: "Night lights over the Douro",
				number: 105,
				takenAt: new Date("2023-07-01T21:00:00Z"),
				createdAt: new Date("2026-01-15T00:00:00Z"),
			},
		});

		// 106: only in a draft gallery, pinned as featured there.
		mock.photo.create({
			data: { ...base, originalKey: "originals/hidden.jpg", title: "Lisbon Hidden", number: 106, createdAt: new Date("2026-01-25T00:00:00Z") },
		});

		// 107: in no gallery at all.
		mock.photo.create({
			data: { ...base, originalKey: "originals/loose.jpg", title: "Lisbon Loose", number: 107, createdAt: new Date("2026-01-30T00:00:00Z") },
		});

		const porto = mock.gallery.create({
			data: { slug: "porto", title: "Porto", status: "PUBLISHED", position: 3 },
		}) as Row;
		const draft = mock.gallery.findFirst({ where: { slug: "wip-gallery" } }) as Row;

		mock.galleryPhoto.create({ data: { galleryId: porto.id, photoId: photoId(105), position: 1, isFeatured: false } });
		mock.galleryPhoto.create({ data: { galleryId: draft.id, photoId: photoId(106), position: 2, isFeatured: true } });

		const landscapes = mock.category.findFirst({ where: { slug: "landscapes" } }) as Row;
		const sunset = mock.tag.findFirst({ where: { slug: "sunset" } }) as Row;

		for (const number of [105, 106, 107]) {
			mock.photoCategory.create({ data: { photoId: photoId(number), categoryId: landscapes.id } });
			mock.photoTag.create({ data: { photoId: photoId(number), tagId: sunset.id } });
		}

		// Hidden taxonomy attached to an exposed photo must never match.
		const retired = mock.category.create({
			data: { name: "Retired", slug: "retired", status: "INACTIVE", position: 2 },
		}) as Row;
		const internal = mock.tag.create({
			data: { name: "Internal", slug: "internal", status: "ACTIVE", visibility: "INTERNAL" },
		}) as Row;
		const inactive = mock.tag.create({
			data: { name: "Old", slug: "old", status: "INACTIVE", visibility: "PUBLIC" },
		}) as Row;

		mock.photoCategory.create({ data: { photoId: photoId(104), categoryId: retired.id } });
		mock.photoTag.create({ data: { photoId: photoId(104), tagId: internal.id } });
		mock.photoTag.create({ data: { photoId: photoId(104), tagId: inactive.id } });
	});

	it("returns only exposed photos, newest first by default", async () => {
		const { statusCode, body } = await list("");

		expect(statusCode).toBe(200);
		expect(body.total).toBe(3);
		expect(body.page).toBe(1);
		expect(body.pageSize).toBe(20);
		// 102 draft, 103 private, 106 draft gallery only, 107 no gallery.
		expect(numbersOf(body)).toEqual([104, 105, 101]);
	});

	it("sorts newest and oldest by createdAt", async () => {
		expect(numbersOf((await list("?sort=newest")).body)).toEqual([104, 105, 101]);
		expect(numbersOf((await list("?sort=oldest")).body)).toEqual([101, 105, 104]);
	});

	it("filters by category slug, ignoring inactive categories", async () => {
		const active = await list("?category=landscapes");
		expect(active.body.total).toBe(2);
		expect(numbersOf(active.body)).toEqual([105, 101]);

		expect((await list("?category=retired")).body.total).toBe(0);
		expect((await list("?category=unknown")).body.total).toBe(0);
	});

	it("filters by tag slug, ignoring inactive and internal tags", async () => {
		const active = await list("?tag=sunset");
		expect(active.body.total).toBe(2);
		expect(numbersOf(active.body)).toEqual([105, 101]);

		expect((await list("?tag=internal")).body.total).toBe(0);
		expect((await list("?tag=old")).body.total).toBe(0);
	});

	it("filters by published gallery slug only", async () => {
		const portugal = await list("?gallery=portugal-2026");
		expect(portugal.body.total).toBe(2);
		expect(numbersOf(portugal.body)).toEqual([104, 101]);

		expect(numbersOf((await list("?gallery=porto")).body)).toEqual([105]);
		expect((await list("?gallery=wip-gallery")).body.total).toBe(0);
		expect((await list("?gallery=unknown")).body.total).toBe(0);
	});

	it("combines gallery, category and tag filters", async () => {
		expect(numbersOf((await list("?gallery=porto&category=landscapes&tag=sunset")).body)).toEqual([105]);
		expect((await list("?gallery=portugal-2026&category=landscapes&tag=internal")).body.total).toBe(0);
	});

	it("filters by takenFrom/takenTo, excluding photos without takenAt", async () => {
		expect(numbersOf((await list("?takenFrom=2024-01-01")).body)).toEqual([101]);
		expect(numbersOf((await list("?takenTo=2024-01-01")).body)).toEqual([105]);
		expect(numbersOf((await list("?takenFrom=2023-01-01&takenTo=2024-12-31")).body)).toEqual([105, 101]);
		expect((await list("?takenFrom=2025-01-01")).body.total).toBe(0);
	});

	it("rejects an impossible date", async () => {
		expect((await list("?takenFrom=2024-13-45")).statusCode).toBe(400);
	});

	it("searches title and description case-insensitively (q)", async () => {
		const title = await list("?q=lisbon");
		expect(title.body.total).toBe(1);
		expect(numbersOf(title.body)).toEqual([101]);

		expect(numbersOf((await list("?q=DOURO")).body)).toEqual([105]);
		expect(numbersOf((await list("?q=%20%20bridge%20")).body)).toEqual([105]);
		expect((await list("?q=nothing-matches")).body.total).toBe(0);
	});

	it("searches by photo number (q digits)", async () => {
		const res = await list("?q=101");

		expect(res.body.total).toBe(1);
		expect(numbersOf(res.body)).toEqual([101]);
	});

	it("sort=featured keeps photos pinned as featured in a published gallery", async () => {
		const res = await list("?sort=featured");

		// 106 is pinned only in a draft gallery.
		expect(res.body.total).toBe(1);
		expect(numbersOf(res.body)).toEqual([101]);

		expect(numbersOf((await list("?sort=featured&gallery=portugal-2026")).body)).toEqual([101]);
		expect((await list("?sort=featured&gallery=porto")).body.total).toBe(0);
		expect((await list("?sort=featured&tag=internal")).body.total).toBe(0);
	});

	it("paginates in order with a stable total", async () => {
		const pages = await Promise.all([1, 2, 3, 4].map((page) => list(`?pageSize=1&page=${page}`)));

		expect(pages.map((p) => p.body.total)).toEqual([3, 3, 3, 3]);
		expect(pages.map((p) => numbersOf(p.body))).toEqual([[104], [105], [101], []]);

		const oldest = await list("?sort=oldest&pageSize=2&page=2");
		expect(oldest.body).toMatchObject({ page: 2, pageSize: 2, total: 3 });
		expect(numbersOf(oldest.body)).toEqual([104]);
	});

	it("pages and counts in the database instead of loading every photo", async () => {
		const findMany = vi.spyOn(mock.photo, "findMany");
		const count = vi.spyOn(mock.photo, "count");

		try {
			await list("?page=3&pageSize=7&category=landscapes");

			expect(findMany).toHaveBeenCalledTimes(1);
			expect(findMany.mock.calls[0][0]).toMatchObject({ skip: 14, take: 7, orderBy: { createdAt: "desc" } });
			expect(count).toHaveBeenCalledTimes(1);
		} finally {
			findMany.mockRestore();
			count.mockRestore();
		}
	});
});

describe("public atlas endpoints", () => {
	// Runs after the shared outer seed above.
	beforeEach(() => {
		const pub = mock.atlasLocation.create({
			data: {
				slug: "graca-miradouro",
				name: "Miradouro da Graça",
				description: "Castle hill light.",
				country: "PT",
				city: "Lisbon",
				geometryKind: "POINT",
				latitude: 38.7119,
				longitude: -9.1257,
				status: "PUBLISHED",
			},
		}) as { id: string; slug: string };

		mock.atlasLocation.create({
			data: { slug: "wip-spot", name: "Work in progress", geometryKind: "POINT", latitude: 0, longitude: 0, status: "DRAFT" },
		});

		const category = mock.category.create({
			data: { name: "Street", slug: "street", status: "ACTIVE", position: 9 },
		}) as { id: string; slug: string };

		mock.atlasLocationCategory.create({ data: { locationId: pub.id, categoryId: category.id } });
		mock.atlasLocationPhoto.create({
			data: {
				locationId: pub.id,
				photoId: (mock.photo.findFirst({ where: { number: 101 } }) as { id: string }).id,
				caption: "Dawn",
				position: 0,
			},
		});
	});

	it("lists only published locations with categories", async () => {
		const res = await app.inject({ method: "GET", url: "/v1/public/atlas/locations" });

		expect(res.statusCode).toBe(200);
		expect(res.json().total).toBe(1);
		expect(res.json().items[0].slug).toBe("graca-miradouro");
		expect(res.json().items[0].categories).toEqual([{ slug: "street", name: "Street" }]);
		expect(res.json().items[0]).not.toHaveProperty("authorId");
	});

	it("returns location detail with photos, cover and editorial fields", async () => {
		const res = await app.inject({ method: "GET", url: "/v1/public/atlas/locations/graca-miradouro" });

		expect(res.statusCode).toBe(200);
		const body = res.json();
		expect(body.photos).toHaveLength(1);
		expect(body.photos[0]).toMatchObject({ number: 101, caption: "Dawn", position: 0 });
		expect(body).not.toHaveProperty("authorId");
	});

	it("returns 404 for draft and unknown slugs", async () => {
		expect((await app.inject({ method: "GET", url: "/v1/public/atlas/locations/wip-spot" })).statusCode).toBe(404);
		expect((await app.inject({ method: "GET", url: "/v1/public/atlas/locations/unknown" })).statusCode).toBe(404);
	});

	it("filters by country, category, query and bbox", async () => {
		const country = await app.inject({ method: "GET", url: "/v1/public/atlas/locations?country=ES" });
		expect(country.json().total).toBe(0);

		const category = await app.inject({ method: "GET", url: "/v1/public/atlas/locations?category=street" });
		expect(category.json().total).toBe(1);

		const query = await app.inject({ method: "GET", url: "/v1/public/atlas/locations?q=gra%C3%A7a" });
		expect(query.json().total).toBe(1);

		const bbox = await app.inject({ method: "GET", url: "/v1/public/atlas/locations?bbox=-10,38,-9,39" });
		expect(bbox.json().total).toBe(1);

		const outside = await app.inject({ method: "GET", url: "/v1/public/atlas/locations?bbox=0,0,1,1" });
		expect(outside.json().total).toBe(0);
	});
});