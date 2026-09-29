import { Prisma, type AtlasLocation, type AtlasLocationStatus } from "@prisma/client";
import { prisma } from "../../db/prisma.js";
import { ConflictError } from "../../errors/appError.js";

export interface CreateLocationInput {
	slug: string;
	name: string;
	description?: string | null;
	country?: string | null;
	region?: string | null;
	city?: string | null;
	geometryKind?: "POINT" | "AREA";
	latitude?: number | null;
	longitude?: number | null;
	geoJson?: unknown;
	whyInteresting?: string | null;
	subjects?: string | null;
	accessNotes?: string | null;
	safetyNotes?: string | null;
	coverPhotoId?: string | null;
	authorId?: string | null;
}

// undefined = leave unchanged, null = clear (PATCH semantics without Prisma
// FieldUpdates so the mock and Prisma behave identically).
export interface UpdateLocationInput {
	name?: string;
	description?: string | null;
	country?: string | null;
	region?: string | null;
	city?: string | null;
	geometryKind?: "POINT" | "AREA";
	latitude?: number | null;
	longitude?: number | null;
	geoJson?: unknown;
	whyInteresting?: string | null;
	subjects?: string | null;
	accessNotes?: string | null;
	safetyNotes?: string | null;
	coverPhotoId?: string | null;
	status?: AtlasLocationStatus;
	publishedAt?: Date | null;
}

export interface ListLocationsWhere {
	status?: AtlasLocationStatus | { not: AtlasLocationStatus };
	country?: string;
	id?: { in: string[] };
	latitude?: { gte?: number; lte?: number };
	longitude?: { gte?: number; lte?: number };
	OR?: Prisma.AtlasLocationWhereInput[];
}

function translateConflict(error: unknown): never {
	if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
		throw new ConflictError("Atlas location slug already exists");
	}

	throw error;
}

export async function findLocationById(id: string): Promise<AtlasLocation | null> {
	return prisma.atlasLocation.findUnique({ where: { id } });
}

export async function findLocationBySlug(slug: string): Promise<AtlasLocation | null> {
	return prisma.atlasLocation.findUnique({ where: { slug } });
}

export async function listLocations(where: ListLocationsWhere, skip: number, take: number): Promise<AtlasLocation[]> {
	return prisma.atlasLocation.findMany({
		where: where as Prisma.AtlasLocationWhereInput,
		orderBy: { createdAt: "desc" },
		skip,
		take,
	});
}

export async function countLocations(where: ListLocationsWhere): Promise<number> {
	return prisma.atlasLocation.count({ where: where as Prisma.AtlasLocationWhereInput });
}

export async function createLocation(input: CreateLocationInput): Promise<AtlasLocation> {
	try {
		return await prisma.atlasLocation.create({
			data: {
				slug: input.slug,
				name: input.name,
				description: input.description ?? null,
				country: input.country ?? null,
				region: input.region ?? null,
				city: input.city ?? null,
				geometryKind: input.geometryKind ?? "POINT",
				latitude: input.latitude ?? null,
				longitude: input.longitude ?? null,
				geoJson: (input.geoJson ?? undefined) as Prisma.InputJsonValue | undefined,
				whyInteresting: input.whyInteresting ?? null,
				subjects: input.subjects ?? null,
				accessNotes: input.accessNotes ?? null,
				safetyNotes: input.safetyNotes ?? null,
				coverPhotoId: input.coverPhotoId ?? null,
				authorId: input.authorId ?? null,
				// Schema default the mock does not fill itself.
				status: "DRAFT",
			},
		});
	}
	catch (error) {
		translateConflict(error);
	}
}

export async function updateLocation(id: string, input: UpdateLocationInput): Promise<AtlasLocation> {
	const data: Prisma.AtlasLocationUncheckedUpdateInput = {};

	if (input.name !== undefined) {
		data.name = input.name;
	}
	if (input.description !== undefined) {
		data.description = input.description;
	}
	if (input.country !== undefined) {
		data.country = input.country;
	}
	if (input.region !== undefined) {
		data.region = input.region;
	}
	if (input.city !== undefined) {
		data.city = input.city;
	}
	if (input.geometryKind !== undefined) {
		data.geometryKind = input.geometryKind;
	}
	if (input.latitude !== undefined) {
		data.latitude = input.latitude;
	}
	if (input.longitude !== undefined) {
		data.longitude = input.longitude;
	}
	if (input.geoJson !== undefined) {
		data.geoJson = (input.geoJson ?? Prisma.DbNull) as Prisma.InputJsonValue;
	}
	if (input.whyInteresting !== undefined) {
		data.whyInteresting = input.whyInteresting;
	}
	if (input.subjects !== undefined) {
		data.subjects = input.subjects;
	}
	if (input.accessNotes !== undefined) {
		data.accessNotes = input.accessNotes;
	}
	if (input.safetyNotes !== undefined) {
		data.safetyNotes = input.safetyNotes;
	}
	if (input.coverPhotoId !== undefined) {
		data.coverPhotoId = input.coverPhotoId;
	}
	if (input.status !== undefined) {
		data.status = input.status;
	}
	if (input.publishedAt !== undefined) {
		data.publishedAt = input.publishedAt;
	}

	try {
		return await prisma.atlasLocation.update({ where: { id }, data });
	}
	catch (error) {
		translateConflict(error);
	}
}

export interface LocationPhotoEntry {
	photoId: string;
	caption: string | null;
	position: number;
}

export async function getLocationPhotoIds(locationId: string): Promise<LocationPhotoEntry[]> {
	const rows = await prisma.atlasLocationPhoto.findMany({ where: { locationId }, orderBy: { position: "asc" } });

	return rows.map((row) => ({ photoId: row.photoId, caption: row.caption, position: row.position }));
}

// Full replacement keeps positions dense (0..n) as the schema requires.
export async function replaceLocationPhotos(locationId: string, entries: LocationPhotoEntry[]): Promise<void> {
	await prisma.$transaction(async (tx) => {
		await tx.atlasLocationPhoto.deleteMany({ where: { locationId } });

		for (const entry of entries) {
			await tx.atlasLocationPhoto.create({
				data: { locationId, photoId: entry.photoId, caption: entry.caption, position: entry.position },
			});
		}
	});
}

export async function getLocationCategoryIds(locationId: string): Promise<string[]> {
	const rows = await prisma.atlasLocationCategory.findMany({ where: { locationId } });

	return rows.map((row) => row.categoryId);
}

export async function findLocationCategories(
	locationId: string,
): Promise<{ categoryId: string; slug: string; name: string }[]> {
	const rows = await prisma.atlasLocationCategory.findMany({ where: { locationId } });

	if (rows.length === 0) {
		return [];
	}

	const categories = await prisma.category.findMany({
		where: { id: { in: rows.map((row) => row.categoryId) } },
		select: { id: true, slug: true, name: true },
	});
	const byId = new Map(categories.map((category) => [category.id, category]));

	return rows.map((row) => ({
		categoryId: row.categoryId,
		slug: byId.get(row.categoryId)?.slug ?? "",
		name: byId.get(row.categoryId)?.name ?? "",
	}));
}

export async function replaceLocationCategories(locationId: string, categoryIds: string[]): Promise<void> {
	await prisma.$transaction(async (tx) => {
		await tx.atlasLocationCategory.deleteMany({ where: { locationId } });

		for (const categoryId of categoryIds) {
			await tx.atlasLocationCategory.create({ data: { locationId, categoryId } });
		}
	});
}

export async function findLocationIdsByCategoryIds(categoryIds: string[]): Promise<string[]> {
	if (categoryIds.length === 0) {
		return [];
	}

	const rows = await prisma.atlasLocationCategory.findMany({ where: { categoryId: { in: categoryIds } } });

	return [...new Set(rows.map((row) => row.locationId))];
}

export async function findCategoriesBySlugs(slugs: string[]): Promise<{ id: string; slug: string; name: string }[]> {
	if (slugs.length === 0) {
		return [];
	}

	return prisma.category.findMany({ where: { slug: { in: slugs } }, select: { id: true, slug: true, name: true } });
}

export async function findPhotosByIds(ids: string[]): Promise<{ id: string }[]> {
	if (ids.length === 0) {
		return [];
	}

	return prisma.photo.findMany({ where: { id: { in: ids } }, select: { id: true } });
}

export async function findCoverPhoto(id: string): Promise<{ id: string } | null> {
	return prisma.photo.findUnique({ where: { id }, select: { id: true } });
}
