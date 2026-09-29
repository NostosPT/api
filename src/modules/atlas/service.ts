import { randomBytes } from "node:crypto";
import { logAudit } from "../../audit/log.js";
import { ConflictError, NotFoundError, ValidationError } from "../../errors/appError.js";
import { toAtlasLocationDTO, type AtlasLocationDetailDTO, type AtlasLocationList } from "./dto.js";
import {
	countLocations,
	createLocation,
	findCategoriesBySlugs,
	findCoverPhoto,
	findLocationById,
	findLocationBySlug,
	findLocationCategories,
	findLocationIdsByCategoryIds,
	findPhotosByIds,
	getLocationPhotoIds,
	listLocations,
	replaceLocationCategories,
	replaceLocationPhotos,
	updateLocation,
	type ListLocationsWhere,
} from "./repository.js";
import type {
	CreateLocationBody,
	ListLocationsQuery,
	SetLocationCategoriesBody,
	SetLocationPhotosBody,
	UpdateLocationBody,
} from "./schemas.js";

function slugifyTitle(title: string): string {
	const base = title
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 48);

	return base === "" ? "location" : base;
}

// Public identifier (schema: "guessable OK") â€” still unique per location.
function generateSlug(name: string): string {
	return `${slugifyTitle(name)}-${randomBytes(3).toString("hex")}`;
}

async function getLocationOrThrow(id: string) {
	const location = await findLocationById(id);

	if (location === null) {
		throw new NotFoundError("Atlas location not found");
	}

	return location;
}

type GeometryInput = {
	geometryKind?: "POINT" | "AREA";
	latitude?: number | null;
	longitude?: number | null;
	geoJson?: unknown;
};

function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

function assertRing(ring: unknown, path: string): void {
	if (!Array.isArray(ring) || ring.length < 4) {
		throw new ValidationError(`${path} must have at least 4 positions`);
	}

	for (const [index, position] of ring.entries()) {
		if (!Array.isArray(position) || position.length < 2) {
			throw new ValidationError(`${path}[${index}] must be a [lng, lat] pair`);
		}

		const [lng, lat] = position;

		if (!isFiniteNumber(lng) || !isFiniteNumber(lat) || lng < -180 || lng > 180 || lat < -90 || lat > 90) {
			throw new ValidationError(`${path}[${index}] has out-of-range coordinates`);
		}
	}

	const first = ring[0] as number[];
	const last = ring[ring.length - 1] as number[];

	if (first[0] !== last[0] || first[1] !== last[1]) {
		throw new ValidationError(`${path} must be closed (first and last positions equal)`);
	}
}

function assertGeoJson(value: unknown): void {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new ValidationError("geoJson must be a GeoJSON Polygon or MultiPolygon object");
	}

	const { type, coordinates } = value as { type?: unknown; coordinates?: unknown };

	if (type !== "Polygon" && type !== "MultiPolygon") {
		throw new ValidationError('geoJson.type must be "Polygon" or "MultiPolygon"');
	}

	const polygons = type === "Polygon" ? [coordinates] : coordinates;

	if (!Array.isArray(polygons) || polygons.length === 0) {
		throw new ValidationError("geoJson.coordinates must not be empty");
	}

	for (const [pi, polygon] of polygons.entries()) {
		if (!Array.isArray(polygon) || polygon.length === 0) {
			throw new ValidationError(`geoJson.coordinates[${pi}] must not be empty`);
		}

		for (const [ri, ring] of (polygon as unknown[]).entries()) {
			assertRing(ring, `geoJson.coordinates[${pi}][${ri}]`);
		}
	}
}

// POINT carries lat/lng and no geoJson; AREA carries geoJson and no lat/lng.
// The invariant keeps future PostGIS migration (generated geometry column)
// unambiguous.
function assertGeometry(input: Required<Pick<GeometryInput, "geometryKind">> & Omit<GeometryInput, "geometryKind">): void {
	if (input.geometryKind === "POINT") {
		if (!isFiniteNumber(input.latitude) || input.latitude < -90 || input.latitude > 90) {
			throw new ValidationError("POINT locations require latitude between -90 and 90");
		}

		if (!isFiniteNumber(input.longitude) || input.longitude < -180 || input.longitude > 180) {
			throw new ValidationError("POINT locations require longitude between -180 and 180");
		}

		if (input.geoJson !== undefined && input.geoJson !== null) {
			throw new ValidationError("POINT locations must not carry geoJson");
		}

		return;
	}

	if (input.latitude !== undefined && input.latitude !== null) {
		throw new ValidationError("AREA locations must not carry latitude");
	}

	if (input.longitude !== undefined && input.longitude !== null) {
		throw new ValidationError("AREA locations must not carry longitude");
	}

	if (input.geoJson === undefined || input.geoJson === null) {
		throw new ValidationError("AREA locations require geoJson");
	}

	assertGeoJson(input.geoJson);
}

export interface Bbox {
	minLng: number;
	minLat: number;
	maxLng: number;
	maxLat: number;
}

// Map viewport filter. Antimeridian crossings (minLng > maxLng) are rejected
// instead of normalized; max 60x60 degrees keeps result sets bounded.
export function parseBbox(raw: string): Bbox {
	const parts = raw.split(",").map((part) => Number(part));

	if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) {
		throw new ValidationError("bbox must be minLng,minLat,maxLng,maxLat numbers");
	}

	const [minLng, minLat, maxLng, maxLat] = parts as [number, number, number, number];

	if (minLng < -180 || maxLng > 180 || minLat < -90 || maxLat > 90) {
		throw new ValidationError("bbox is out of world range");
	}

	if (minLng > maxLng || minLat > maxLat) {
		throw new ValidationError("bbox minima must not exceed maxima (antimeridian not supported)");
	}

	if ((maxLng - minLng) * (maxLat - minLat) > 3600) {
		throw new ValidationError("bbox area exceeds the 60x60 degree limit");
	}

	return { minLng, minLat, maxLng, maxLat };
}

export interface LocationFilters {
	status?: ListLocationsQuery["status"];
	country?: string;
	category?: string;
	q?: string;
	bbox?: Bbox;
}

async function resolveCategoryIds(slugs: string[] | undefined): Promise<string[] | null> {
	if (slugs === undefined) {
		return null;
	}

	if (slugs.length === 0) {
		return [];
	}

	const unique = [...new Set(slugs.map((slug) => slug.trim().toLowerCase()))];
	const found = await findCategoriesBySlugs(unique);
	const foundSlugs = new Set(found.map((category) => category.slug));
	const missing = unique.filter((slug) => !foundSlugs.has(slug));

	if (missing.length > 0) {
		throw new NotFoundError(`Unknown categories: ${missing.join(", ")}`);
	}

	return found.map((category) => category.id);
}

export async function listAllAtlasLocations(
	page: number,
	pageSize: number,
	filters: LocationFilters = {},
): Promise<AtlasLocationList> {
	let candidateIds: Set<string> | null = null;

	if (filters.category !== undefined) {
		const categoryIds = await resolveCategoryIds([filters.category]);

		if (categoryIds === null || categoryIds.length === 0) {
			return { items: [], page, pageSize, total: 0 };
		}

		candidateIds = new Set(await findLocationIdsByCategoryIds(categoryIds));
	}

	const where: ListLocationsWhere = {
		// Archived locations are hidden unless explicitly requested (albums precedent).
		status: filters.status ?? { not: "ARCHIVED" },
		...(filters.country === undefined ? {} : { country: filters.country }),
		...(candidateIds === null ? {} : { id: { in: [...candidateIds] } }),
		...(filters.bbox === undefined
			? {}
			: {
					latitude: { gte: filters.bbox.minLat, lte: filters.bbox.maxLat },
					longitude: { gte: filters.bbox.minLng, lte: filters.bbox.maxLng },
				}),
		...(filters.q === undefined
			? {}
			: {
					OR: [
						{ name: { contains: filters.q, mode: "insensitive" } },
						{ description: { contains: filters.q, mode: "insensitive" } },
						{ city: { contains: filters.q, mode: "insensitive" } },
						{ region: { contains: filters.q, mode: "insensitive" } },
					],
				}),
	};

	const [items, total] = await Promise.all([
		listLocations(where, (page - 1) * pageSize, pageSize),
		countLocations(where),
	]);

	return { items: items.map(toAtlasLocationDTO), page, pageSize, total };
}

async function toLocationDetail(id: string): Promise<AtlasLocationDetailDTO> {
	const location = await getLocationOrThrow(id);
	const [categories, entries] = await Promise.all([findLocationCategories(id), getLocationPhotoIds(id)]);

	return {
		...toAtlasLocationDTO(location),
		categories: categories.map((category) => ({ categoryId: category.categoryId, slug: category.slug, name: category.name })),
		photos: entries.map((entry) => ({ photoId: entry.photoId, caption: entry.caption, position: entry.position })),
	};
}

export async function getLocation(id: string): Promise<AtlasLocationDetailDTO> {
	return toLocationDetail(id);
}

async function assertCoverPhotoExists(coverPhotoId: string | null | undefined): Promise<void> {
	if (coverPhotoId === undefined || coverPhotoId === null) {
		return;
	}

	const photo = await findCoverPhoto(coverPhotoId);

	if (photo === null) {
		throw new NotFoundError("Cover photo not found");
	}
}

export async function createLocationRecord(actorId: string, input: CreateLocationBody): Promise<AtlasLocationDetailDTO> {
	const geometryKind = input.geometryKind ?? "POINT";

	assertGeometry({
		geometryKind,
		latitude: input.latitude,
		longitude: input.longitude,
		geoJson: input.geoJson,
	});

	const slug = input.slug ?? generateSlug(input.name);
	const existingSlug = await findLocationBySlug(slug);

	if (existingSlug !== null) {
		throw new ConflictError("Atlas location slug already exists");
	}

	await assertCoverPhotoExists(input.coverPhotoId);

	const location = await createLocation({
		slug,
		name: input.name.trim(),
		description: input.description?.trim() ?? null,
		country: input.country ?? null,
		region: input.region?.trim() || null,
		city: input.city?.trim() || null,
		geometryKind,
		latitude: input.latitude ?? null,
		longitude: input.longitude ?? null,
		geoJson: input.geoJson ?? null,
		whyInteresting: input.whyInteresting?.trim() || null,
		subjects: input.subjects?.trim() || null,
		accessNotes: input.accessNotes?.trim() || null,
		safetyNotes: input.safetyNotes?.trim() || null,
		coverPhotoId: input.coverPhotoId ?? null,
		authorId: actorId,
	});

	await logAudit({
		actorId,
		action: "atlas.create",
		resourceType: "atlas_location",
		resourceId: location.id,
		result: "SUCCESS",
		metadata: { slug: location.slug, name: location.name },
	});

	return toLocationDetail(location.id);
}

export async function updateLocationRecord(
	actorId: string,
	id: string,
	patch: UpdateLocationBody,
): Promise<AtlasLocationDetailDTO> {
	const current = await getLocationOrThrow(id);

	const geometryKind = patch.geometryKind ?? current.geometryKind;
	const kindChanged = patch.geometryKind !== undefined && patch.geometryKind !== current.geometryKind;

	// Validate the merged geometry so partial PATCHes cannot break the
	// invariant. A kind switch clears the other representation unless the
	// patch explicitly provides new values.
	assertGeometry({
		geometryKind,
		latitude: patch.latitude !== undefined ? patch.latitude : kindChanged ? null : current.latitude,
		longitude: patch.longitude !== undefined ? patch.longitude : kindChanged ? null : current.longitude,
		geoJson: patch.geoJson !== undefined ? patch.geoJson : kindChanged ? null : (current.geoJson as unknown),
	});

	await assertCoverPhotoExists(patch.coverPhotoId);

	// Switching kinds clears the other representation to keep the invariant.
	const next: Parameters<typeof updateLocation>[1] = {
		...(patch.name === undefined ? {} : { name: patch.name.trim() }),
		...(patch.description === undefined
			? {}
			: { description: patch.description === null ? null : patch.description.trim() }),
		...(patch.country === undefined ? {} : { country: patch.country }),
		...(patch.region === undefined ? {} : { region: patch.region === null ? null : patch.region.trim() || null }),
		...(patch.city === undefined ? {} : { city: patch.city === null ? null : patch.city.trim() || null }),
		...(patch.geometryKind === undefined
			? {}
			: {
					geometryKind: patch.geometryKind,
					...(patch.geometryKind === "POINT"
						? { geoJson: null }
						: { latitude: null, longitude: null }),
				}),
		...(patch.latitude === undefined ? {} : { latitude: patch.latitude }),
		...(patch.longitude === undefined ? {} : { longitude: patch.longitude }),
		...(patch.geoJson === undefined ? {} : { geoJson: patch.geoJson }),
		...(patch.whyInteresting === undefined
			? {}
			: { whyInteresting: patch.whyInteresting === null ? null : patch.whyInteresting.trim() || null }),
		...(patch.subjects === undefined
			? {}
			: { subjects: patch.subjects === null ? null : patch.subjects.trim() || null }),
		...(patch.accessNotes === undefined
			? {}
			: { accessNotes: patch.accessNotes === null ? null : patch.accessNotes.trim() || null }),
		...(patch.safetyNotes === undefined
			? {}
			: { safetyNotes: patch.safetyNotes === null ? null : patch.safetyNotes.trim() || null }),
		...(patch.coverPhotoId === undefined ? {} : { coverPhotoId: patch.coverPhotoId }),
	};

	await updateLocation(id, next);

	await logAudit({
		actorId,
		action: "atlas.update",
		resourceType: "atlas_location",
		resourceId: id,
		result: "SUCCESS",
		metadata: null,
	});

	return toLocationDetail(id);
}

export async function publishLocation(actorId: string, id: string): Promise<AtlasLocationDetailDTO> {
	const location = await getLocationOrThrow(id);

	if (location.status === "ARCHIVED") {
		throw new ValidationError("Archived location cannot be published");
	}

	if (location.status === "PUBLISHED") {
		throw new ValidationError("Location is already published");
	}

	await updateLocation(id, { status: "PUBLISHED", publishedAt: new Date() });

	await logAudit({
		actorId,
		action: "atlas.publish",
		resourceType: "atlas_location",
		resourceId: id,
		result: "SUCCESS",
		metadata: { from: "DRAFT", to: "PUBLISHED" },
	});

	return toLocationDetail(id);
}

export async function unpublishLocation(actorId: string, id: string): Promise<AtlasLocationDetailDTO> {
	const location = await getLocationOrThrow(id);

	if (location.status !== "PUBLISHED") {
		throw new ValidationError("Location is not published");
	}

	await updateLocation(id, { status: "DRAFT" });

	await logAudit({
		actorId,
		action: "atlas.unpublish",
		resourceType: "atlas_location",
		resourceId: id,
		result: "SUCCESS",
		metadata: { from: "PUBLISHED", to: "DRAFT" },
	});

	return toLocationDetail(id);
}

// Phase 1 offers archive instead of hard deletion (galleries precedent).
export async function archiveLocation(actorId: string, id: string): Promise<void> {
	const location = await getLocationOrThrow(id);

	if (location.status === "ARCHIVED") {
		throw new ConflictError("Location is already archived");
	}

	await updateLocation(id, { status: "ARCHIVED" });

	await logAudit({
		actorId,
		action: "atlas.archive",
		resourceType: "atlas_location",
		resourceId: id,
		result: "SUCCESS",
		metadata: { from: location.status, to: "ARCHIVED" },
	});
}

export async function setLocationPhotos(
	actorId: string,
	id: string,
	input: SetLocationPhotosBody,
): Promise<AtlasLocationDetailDTO> {
	await getLocationOrThrow(id);

	// Dense positions require uniqueness: first occurrence wins.
	const photoIds = [...new Set(input.photoIds)];

	const existing = await findPhotosByIds(photoIds);
	const existingIds = new Set(existing.map((photo) => photo.id));
	const missing = photoIds.filter((photoId) => !existingIds.has(photoId));

	if (missing.length > 0) {
		throw new ValidationError("One or more photos do not exist");
	}

	const captions = input.captions ?? {};
	const unknownCaptionKeys = Object.keys(captions).filter((key) => !existingIds.has(key));

	if (unknownCaptionKeys.length > 0) {
		throw new ValidationError("Captions reference unknown photos");
	}

	await replaceLocationPhotos(
		id,
		photoIds.map((photoId, index) => ({ photoId, caption: captions[photoId] ?? null, position: index })),
	);

	await logAudit({
		actorId,
		action: "atlas.photos.set",
		resourceType: "atlas_location",
		resourceId: id,
		result: "SUCCESS",
		metadata: { count: photoIds.length },
	});

	return toLocationDetail(id);
}

export async function setLocationCategories(
	actorId: string,
	id: string,
	input: SetLocationCategoriesBody,
): Promise<AtlasLocationDetailDTO> {
	await getLocationOrThrow(id);

	const unique = [...new Set(input.categorySlugs.map((slug) => slug.trim().toLowerCase()))];
	const found = await findCategoriesBySlugs(unique);
	const foundSlugs = new Set(found.map((category) => category.slug));
	const missing = unique.filter((slug) => !foundSlugs.has(slug));

	if (missing.length > 0) {
		throw new NotFoundError(`Unknown categories: ${missing.join(", ")}`);
	}

	await replaceLocationCategories(
		id,
		found.map((category) => category.id),
	);

	await logAudit({
		actorId,
		action: "atlas.categories.set",
		resourceType: "atlas_location",
		resourceId: id,
		result: "SUCCESS",
		metadata: { count: found.length },
	});

	return toLocationDetail(id);
}
