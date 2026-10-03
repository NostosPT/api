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

const LISBON_POLYGON = {
	type: "Polygon",
	coordinates: [
		[
			[-9.2, 38.7],
			[-9.1, 38.7],
			[-9.1, 38.8],
			[-9.2, 38.8],
			[-9.2, 38.7],
		],
	],
};

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

	mock.category.create({ data: { name: "Street", slug: "street", position: 0 } });
	mock.category.create({ data: { name: "Landscape", slug: "landscape", position: 1 } });

	photoA = (mock.photo.create({
		data: { originalKey: "originals/atlas-a.jpg", status: "PUBLISHED", uploadStatus: "READY", visibility: "PUBLIC", availability: "AVAILABLE", currency: "EUR" },
	}) as { id: string }).id;
	photoB = (mock.photo.create({
		data: { originalKey: "originals/atlas-b.jpg", status: "PUBLISHED", uploadStatus: "READY", visibility: "PUBLIC", availability: "AVAILABLE", currency: "EUR" },
	}) as { id: string }).id;
});

async function createLocation(cookie: string, payload: Record<string, unknown>) {
	return app.inject({
		method: "POST",
		url: "/v1/atlas/locations",
		headers: { cookie },
		payload,
	});
}

describe("atlas locations", () => {
	it("creates POINT locations with generated slugs and records the author", async () => {
		const res = await createLocation(adminCookie, {
			name: "Miradouro da Graça",
			country: "PT",
			city: "Lisbon",
			latitude: 38.7119,
			longitude: -9.1257,
			whyInteresting: "Golden light over the castle hill.",
		});

		expect(res.statusCode).toBe(201);
		const body = res.json();
		expect(body.slug).toMatch(/^miradouro-da-gra[a-z-]*[0-9a-f]{6}$/);
		expect(body.geometryKind).toBe("POINT");
		expect(body.status).toBe("DRAFT");
		expect(body.authorId).toBeDefined();
		expect(auditActions(mock)).toContain("atlas.create");
	});

	it("creates AREA locations with valid GeoJSON polygons", async () => {
		const res = await createLocation(adminCookie, {
			name: "Alfama crawl",
			geometryKind: "AREA",
			geoJson: LISBON_POLYGON,
		});

		expect(res.statusCode).toBe(201);
		expect(res.json().geometryKind).toBe("AREA");
		expect(res.json().latitude).toBeNull();
	});

	it("rejects invalid geometry combinations", async () => {
		// AREA without geoJson.
		const noGeo = await createLocation(adminCookie, { name: "Nowhere", geometryKind: "AREA" });
		expect(noGeo.statusCode).toBe(400);

		// POINT carrying geoJson.
		const pointGeo = await createLocation(adminCookie, {
			name: "Mixed",
			latitude: 38.7,
			longitude: -9.1,
			geoJson: LISBON_POLYGON,
		});
		expect(pointGeo.statusCode).toBe(400);

		// Unclosed ring.
		const openRing = await createLocation(adminCookie, {
			name: "Open",
			geometryKind: "AREA",
			geoJson: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1]]] },
		});
		expect(openRing.statusCode).toBe(400);

		// Out-of-range latitude.
		const badLat = await createLocation(adminCookie, { name: "High", latitude: 91, longitude: 0 });
		expect(badLat.statusCode).toBe(400);
	});

	it("rejects duplicate slugs with conflict", async () => {
		const first = await createLocation(adminCookie, { name: "Dup", slug: "dup-spot", latitude: 1, longitude: 1 });
		expect(first.statusCode).toBe(201);

		const second = await createLocation(adminCookie, { name: "Dup", slug: "dup-spot", latitude: 1, longitude: 1 });
		expect(second.statusCode).toBe(409);
	});

	it("updates fields and clears the other geometry on kind switch", async () => {
		const created = await createLocation(adminCookie, { name: "Switch", latitude: 10, longitude: 10 });
		const id = created.json().id as string;

		const res = await app.inject({
			method: "PATCH",
			url: `/v1/atlas/locations/${id}`,
			headers: { cookie: adminCookie },
			payload: { geometryKind: "AREA", geoJson: LISBON_POLYGON, city: "Lisbon" },
		});

		expect(res.statusCode).toBe(200);
		const body = res.json();
		expect(body.geometryKind).toBe("AREA");
		expect(body.latitude).toBeNull();
		expect(body.longitude).toBeNull();
		expect(body.city).toBe("Lisbon");
	});

	it("walks the publish state machine with guards", async () => {
		const created = await createLocation(adminCookie, { name: "State", latitude: 1, longitude: 1 });
		const id = created.json().id as string;

		const published = await app.inject({ method: "POST", url: `/v1/atlas/locations/${id}/publish`, headers: { cookie: adminCookie } });
		expect(published.statusCode).toBe(200);
		expect(published.json().status).toBe("PUBLISHED");

		const republish = await app.inject({ method: "POST", url: `/v1/atlas/locations/${id}/publish`, headers: { cookie: adminCookie } });
		expect(republish.statusCode).toBe(400);

		const unpublished = await app.inject({ method: "POST", url: `/v1/atlas/locations/${id}/unpublish`, headers: { cookie: adminCookie } });
		expect(unpublished.statusCode).toBe(200);

		const archived = await app.inject({ method: "DELETE", url: `/v1/atlas/locations/${id}`, headers: { cookie: adminCookie } });
		expect(archived.statusCode).toBe(200);

		const rearchive = await app.inject({ method: "DELETE", url: `/v1/atlas/locations/${id}`, headers: { cookie: adminCookie } });
		expect(rearchive.statusCode).toBe(409);
	});

	it("sets photos with captions, dedupes and rejects unknown photos", async () => {
		const created = await createLocation(adminCookie, { name: "Shots", latitude: 1, longitude: 1 });
		const id = created.json().id as string;

		const set = await app.inject({
			method: "PUT",
			url: `/v1/atlas/locations/${id}/photos`,
			headers: { cookie: adminCookie },
			payload: { photoIds: [photoA, photoB, photoA], captions: { [photoA]: "Dawn" } },
		});

		expect(set.statusCode).toBe(200);
		expect(set.json().photos).toHaveLength(2);
		expect(set.json().photos[0]).toMatchObject({ caption: "Dawn", position: 0 });

		const unknown = await app.inject({
			method: "PUT",
			url: `/v1/atlas/locations/${id}/photos`,
			headers: { cookie: adminCookie },
			payload: { photoIds: ["00000000-0000-4000-8000-000000000099"] },
		});

		expect(unknown.statusCode).toBe(400);
	});

	it("sets categories and rejects unknown slugs", async () => {
		const created = await createLocation(adminCookie, { name: "Cats", latitude: 1, longitude: 1 });
		const id = created.json().id as string;

		const set = await app.inject({
			method: "PUT",
			url: `/v1/atlas/locations/${id}/categories`,
			headers: { cookie: adminCookie },
			payload: { categorySlugs: ["street", "landscape"] },
		});

		expect(set.statusCode).toBe(200);
		expect(set.json().categories.map((c: { slug: string }) => c.slug).sort()).toEqual(["landscape", "street"]);

		const unknown = await app.inject({
			method: "PUT",
			url: `/v1/atlas/locations/${id}/categories`,
			headers: { cookie: adminCookie },
			payload: { categorySlugs: ["nope"] },
		});

		expect(unknown.statusCode).toBe(404);
	});

	it("replaces photos and categories with one bulk insert each", async () => {
		const created = await createLocation(adminCookie, { name: "Bulk", latitude: 1, longitude: 1 });
		const id = created.json().id as string;

		await app.inject({
			method: "PUT",
			url: `/v1/atlas/locations/${id}/photos`,
			headers: { cookie: adminCookie },
			payload: { photoIds: [photoA, photoB], captions: { [photoA]: "Dawn" } },
		});
		await app.inject({
			method: "PUT",
			url: `/v1/atlas/locations/${id}/categories`,
			headers: { cookie: adminCookie },
			payload: { categorySlugs: ["street"] },
		});

		const photoCreateMany = vi.spyOn(mock.atlasLocationPhoto, "createMany");
		const photoCreate = vi.spyOn(mock.atlasLocationPhoto, "create");
		const categoryCreateMany = vi.spyOn(mock.atlasLocationCategory, "createMany");
		const categoryCreate = vi.spyOn(mock.atlasLocationCategory, "create");

		const photos = await app.inject({
			method: "PUT",
			url: `/v1/atlas/locations/${id}/photos`,
			headers: { cookie: adminCookie },
			payload: { photoIds: [photoB, photoA], captions: { [photoB]: "Dusk" } },
		});

		expect(photos.statusCode).toBe(200);
		expect(photos.json().photos.map((photo: { photoId: string; caption: string | null; position: number }) => ({
			photoId: photo.photoId,
			caption: photo.caption,
			position: photo.position,
		}))).toEqual([
			{ photoId: photoB, caption: "Dusk", position: 0 },
			{ photoId: photoA, caption: null, position: 1 },
		]);
		expect(photoCreateMany).toHaveBeenCalledTimes(1);
		expect(photoCreate).not.toHaveBeenCalled();

		const categories = await app.inject({
			method: "PUT",
			url: `/v1/atlas/locations/${id}/categories`,
			headers: { cookie: adminCookie },
			payload: { categorySlugs: ["landscape", "street"] },
		});

		expect(categories.statusCode).toBe(200);
		expect(categories.json().categories.map((c: { slug: string }) => c.slug).sort()).toEqual(["landscape", "street"]);
		expect(mock.atlasLocationCategory.rows.filter((row) => row.locationId === id)).toHaveLength(2);
		expect(categoryCreateMany).toHaveBeenCalledTimes(1);
		expect(categoryCreate).not.toHaveBeenCalled();

		photoCreateMany.mockRestore();
		photoCreate.mockRestore();
		categoryCreateMany.mockRestore();
		categoryCreate.mockRestore();
	});

	it("enforces the permission matrix", async () => {
		// Unauthenticated.
		expect((await app.inject({ method: "GET", url: "/v1/atlas/locations" })).statusCode).toBe(401);
		expect((await createLocation(accountantCookie, { name: "X", latitude: 1, longitude: 1 })).statusCode).toBe(403);

		// Photographer curates but does not manage.
		const created = await createLocation(photographerCookie, { name: "Photo spot", latitude: 1, longitude: 1 });
		expect(created.statusCode).toBe(201);
		const id = created.json().id as string;

		expect(
			(await app.inject({ method: "POST", url: `/v1/atlas/locations/${id}/publish`, headers: { cookie: photographerCookie } })).statusCode,
		).toBe(403);

		// Assistant reads but does not write.
		expect(
			(await app.inject({ method: "GET", url: "/v1/atlas/locations", headers: { cookie: assistantCookie } })).statusCode,
		).toBe(200);
		expect((await createLocation(assistantCookie, { name: "Y", latitude: 1, longitude: 1 })).statusCode).toBe(403);

		// Editor curates.
		expect((await createLocation(editorCookie, { name: "Z", latitude: 1, longitude: 1 })).statusCode).toBe(201);
	});

	it("filters listings by status, country, category, query and bbox", async () => {
		const a = await createLocation(adminCookie, { name: "Lisbon rooftops", country: "PT", city: "Lisbon", latitude: 38.72, longitude: -9.14 });
		const b = await createLocation(adminCookie, { name: "Porto river", country: "PT", city: "Porto", latitude: 41.14, longitude: -8.61 });
		const aId = a.json().id as string;

		await app.inject({
			method: "PUT",
			url: `/v1/atlas/locations/${aId}/categories`,
			headers: { cookie: adminCookie },
			payload: { categorySlugs: ["street"] },
		});
		await app.inject({ method: "POST", url: `/v1/atlas/locations/${aId}/publish`, headers: { cookie: adminCookie } });

		const byCountry = await app.inject({ method: "GET", url: "/v1/atlas/locations?country=ES", headers: { cookie: adminCookie } });
		expect(byCountry.json().total).toBe(0);

		const byCategory = await app.inject({ method: "GET", url: "/v1/atlas/locations?category=street", headers: { cookie: adminCookie } });
		expect(byCategory.json().total).toBe(1);

		const byQuery = await app.inject({ method: "GET", url: "/v1/atlas/locations?q=rooftops", headers: { cookie: adminCookie } });
		expect(byQuery.json().total).toBe(1);

		// Bbox around Lisbon only (excludes Porto).
		const byBbox = await app.inject({
			method: "GET",
			url: "/v1/atlas/locations?bbox=-10,38,-9,39",
			headers: { cookie: adminCookie },
		});
		expect(byBbox.json().total).toBe(1);

		const badBbox = await app.inject({
			method: "GET",
			url: "/v1/atlas/locations?bbox=-9,39,-10,38",
			headers: { cookie: adminCookie },
		});
		expect(badBbox.statusCode).toBe(400);

		// Status filter still sees drafts explicitly.
		const drafts = await app.inject({
			method: "GET",
			url: "/v1/atlas/locations?status=DRAFT",
			headers: { cookie: adminCookie },
		});
		expect(drafts.json().total).toBe(1);
		expect(b.json().status).toBe("DRAFT");
	});
});
