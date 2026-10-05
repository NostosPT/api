import type { Prisma, AtlasLocation, Category, Gallery, Photo, Tag } from "@prisma/client";
import { prisma } from "../../db/prisma.js";

export async function findPublishedGalleries(): Promise<Gallery[]> {
	return prisma.gallery.findMany({
		where: { status: "PUBLISHED" },
		orderBy: { position: { sort: "asc", nulls: "last" } },
	});
}

export async function findGalleryBySlugPublic(slug: string): Promise<Gallery | null> {
	return prisma.gallery.findUnique({ where: { slug, status: "PUBLISHED" } });
}

export async function getPublishedGalleryEntries(
	galleryId: string,
): Promise<{ photoId: string; position: number; isFeatured: boolean }[]> {
	const rows = await prisma.galleryPhoto.findMany({
		where: { galleryId },
		orderBy: { position: "asc" },
		select: { photoId: true, position: true, isFeatured: true },
	});

	return rows.map((row) => ({ photoId: row.photoId, position: row.position, isFeatured: row.isFeatured }));
}

export async function findPhotosByIdsPublic(ids: string[]): Promise<Photo[]> {
	if (ids.length === 0) {
		return [];
	}

	return prisma.photo.findMany({
		where: { id: { in: ids }, status: "PUBLISHED", visibility: "PUBLIC" },
		orderBy: { createdAt: "desc" },
	});
}

// Filters for the public photo listing. Slugs are matched together with the
// public gates of their entity, so an unknown or hidden slug yields no rows.
export interface PublicPhotoFilter {
	gallerySlug?: string;
	categorySlug?: string;
	tagSlug?: string;
	featuredOnly?: boolean;
	takenFrom?: Date;
	takenTo?: Date;
	q?: string;
}

// Exposure invariant (see schema.prisma): PUBLISHED + PUBLIC photo that sits
// in at least one PUBLISHED gallery. Relation filters compile to semi-joins,
// so membership, taxonomy and pagination are all resolved in PostgreSQL.
function publicPhotoWhere(filter: PublicPhotoFilter): Prisma.PhotoWhereInput {
	const and: Prisma.PhotoWhereInput[] = [];

	// A gallery or featured pin already implies membership in a published
	// gallery, so the plain membership check is only needed without them.
	if (filter.gallerySlug !== undefined) {
		and.push({ galleryEntries: { some: { gallery: { slug: filter.gallerySlug, status: "PUBLISHED" } } } });
	}

	if (filter.featuredOnly === true) {
		and.push({ galleryEntries: { some: { isFeatured: true, gallery: { status: "PUBLISHED" } } } });
	}

	if (and.length === 0) {
		and.push({ galleryEntries: { some: { gallery: { status: "PUBLISHED" } } } });
	}

	if (filter.categorySlug !== undefined) {
		and.push({ categories: { some: { category: { slug: filter.categorySlug, status: "ACTIVE" } } } });
	}

	if (filter.tagSlug !== undefined) {
		and.push({ tags: { some: { tag: { slug: filter.tagSlug, status: "ACTIVE", visibility: "PUBLIC" } } } });
	}

	if (filter.takenFrom !== undefined || filter.takenTo !== undefined) {
		and.push({
			takenAt: {
				...(filter.takenFrom === undefined ? {} : { gte: filter.takenFrom }),
				...(filter.takenTo === undefined ? {} : { lte: filter.takenTo }),
			},
		});
	}

	if (filter.q !== undefined) {
		const q = filter.q;
		const or: Prisma.PhotoWhereInput[] = [
			{ title: { contains: q, mode: "insensitive" } },
			{ description: { contains: q, mode: "insensitive" } },
		];

		if (/^\d+$/.test(q)) {
			or.push({ number: parseInt(q, 10) });
		}

		and.push({ OR: or });
	}

	return { status: "PUBLISHED", visibility: "PUBLIC", AND: and };
}

export async function listPublicPhotos(
	filter: PublicPhotoFilter,
	skip: number,
	take: number,
	direction: "asc" | "desc",
): Promise<Photo[]> {
	return prisma.photo.findMany({
		where: publicPhotoWhere(filter),
		orderBy: { createdAt: direction },
		skip,
		take,
	});
}

export async function countPublicPhotos(filter: PublicPhotoFilter): Promise<number> {
	return prisma.photo.count({ where: publicPhotoWhere(filter) });
}

export async function findPhotoByNumberPublic(number: number): Promise<Photo | null> {
	const photo = await prisma.photo.findFirst({
		where: { number, status: "PUBLISHED", visibility: "PUBLIC" },
	});

	if (photo === null) {
		return null;
	}

	// Verify it belongs to at least one published gallery.
	const entries = await prisma.galleryPhoto.findMany({
		where: { photoId: photo.id },
		select: { galleryId: true },
	});

	if (entries.length === 0) {
		return null;
	}

	const galleryIds = entries.map((e) => e.galleryId);
	const publishedGallery = await prisma.gallery.findFirst({
		where: { id: { in: galleryIds }, status: "PUBLISHED" },
	});

	if (publishedGallery === null) {
		return null;
	}

	return photo;
}

export async function findPhotographerName(userId: string): Promise<string | null> {
	const user = await prisma.user.findUnique({
		where: { id: userId },
		select: { name: true },
	});

	return user?.name ?? null;
}

export async function findPublicCategories(photoId: string): Promise<Category[]> {
	const rows = await prisma.photoCategory.findMany({
		where: { photoId },
		select: { categoryId: true },
	});

	if (rows.length === 0) {
		return [];
	}

	const categoryIds = rows.map((r) => r.categoryId);

	return prisma.category.findMany({
		where: { id: { in: categoryIds }, status: "ACTIVE" },
		orderBy: { position: "asc" },
	});
}

export async function findPublicTags(photoId: string): Promise<Tag[]> {
	const rows = await prisma.photoTag.findMany({
		where: { photoId },
		select: { tagId: true },
	});

	if (rows.length === 0) {
		return [];
	}

	const tagIds = rows.map((r) => r.tagId);

	return prisma.tag.findMany({
		where: { id: { in: tagIds }, status: "ACTIVE", visibility: "PUBLIC" },
	});
}

export interface PublicAtlasWhere {
	status?: "PUBLISHED";
	country?: string;
	id?: { in: string[] };
	latitude?: { gte?: number; lte?: number };
	longitude?: { gte?: number; lte?: number };
	OR?: Prisma.AtlasLocationWhereInput[];
}

export async function listPublishedAtlasLocations(
	where: PublicAtlasWhere,
	skip: number,
	take: number,
): Promise<AtlasLocation[]> {
	return prisma.atlasLocation.findMany({
		where: where as Prisma.AtlasLocationWhereInput,
		orderBy: { createdAt: "desc" },
		skip,
		take,
	});
}

export async function countPublishedAtlasLocations(where: PublicAtlasWhere): Promise<number> {
	return prisma.atlasLocation.count({ where: where as Prisma.AtlasLocationWhereInput });
}

export async function findAtlasBySlugPublic(slug: string): Promise<AtlasLocation | null> {
	return prisma.atlasLocation.findUnique({ where: { slug, status: "PUBLISHED" } });
}

export async function getPublishedAtlasEntries(
	locationId: string,
): Promise<{ photoId: string; caption: string | null; position: number }[]> {
	const rows = await prisma.atlasLocationPhoto.findMany({ where: { locationId }, orderBy: { position: "asc" } });

	return rows.map((row) => ({ photoId: row.photoId, caption: row.caption, position: row.position }));
}

export async function findAtlasLocationIdsByCategorySlug(slug: string): Promise<string[]> {
	const category = await prisma.category.findUnique({ where: { slug, status: "ACTIVE" }, select: { id: true } });

	if (category === null) {
		return [];
	}

	const rows = await prisma.atlasLocationCategory.findMany({ where: { categoryId: category.id } });

	return [...new Set(rows.map((row) => row.locationId))];
}

export async function findAtlasCategories(locationId: string): Promise<Category[]> {
	const rows = await prisma.atlasLocationCategory.findMany({ where: { locationId }, select: { categoryId: true } });

	if (rows.length === 0) {
		return [];
	}

	return prisma.category.findMany({
		where: { id: { in: rows.map((row) => row.categoryId) }, status: "ACTIVE" },
	});
}