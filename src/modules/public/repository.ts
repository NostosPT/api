import type { Category, Gallery, Photo, Tag } from "@prisma/client";
import { prisma } from "../../db/prisma.js";

export interface PublicPhotoWhere {
	number?: number;
	status?: "PUBLISHED";
	visibility?: "PUBLIC";
	availability?: Photo["availability"];
	takenAt?: { gte?: Date; lte?: Date };
	OR?: Array<{
		title?: { contains: string; mode: "insensitive" };
		description?: { contains: string; mode: "insensitive" };
		number?: number;
	}>;
}

function basePhotoWhere(): PublicPhotoWhere {
	return { status: "PUBLISHED", visibility: "PUBLIC" };
}

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

export async function findPublishedGalleryIds(): Promise<string[]> {
	const galleries = await prisma.gallery.findMany({
		where: { status: "PUBLISHED" },
		select: { id: true },
	});

	return galleries.map((g) => g.id);
}

export async function findMembershipPhotoIds(
	galleryIds: string[],
): Promise<{ photoId: string; isFeatured: boolean }[]> {
	if (galleryIds.length === 0) {
		return [];
	}

	const rows = await prisma.galleryPhoto.findMany({
		where: { galleryId: { in: galleryIds } },
		select: { photoId: true, isFeatured: true },
	});

	return rows.map((row) => ({ photoId: row.photoId, isFeatured: row.isFeatured }));
}

export async function findPhotoIdsByCategorySlug(slug: string): Promise<string[]> {
	const category = await prisma.category.findUnique({
		where: { slug, status: "ACTIVE" },
		select: { id: true },
	});

	if (category === null) {
		return [];
	}

	const rows = await prisma.photoCategory.findMany({
		where: { categoryId: category.id },
		select: { photoId: true },
	});

	return rows.map((row) => row.photoId);
}

export async function findPhotoIdsByTagSlug(slug: string): Promise<string[]> {
	const tag = await prisma.tag.findUnique({
		where: { slug, status: "ACTIVE", visibility: "PUBLIC" },
		select: { id: true },
	});

	if (tag === null) {
		return [];
	}

	const rows = await prisma.photoTag.findMany({
		where: { tagId: tag.id },
		select: { photoId: true },
	});

	return rows.map((row) => row.photoId);
}

// List photos with candidate ID filtering done in JS (avoids mock `in` clause bug).
// `candidatePhotoIds` is the set of photo IDs allowed by gallery membership + filters.
// `where` contains remaining filters (q, takenAt, availability, etc.) WITHOUT id filter.
export async function listPublicPhotos(
	candidatePhotoIds: Set<string>,
	where: PublicPhotoWhere,
	skip: number,
	take: number,
	orderBy: { createdAt: "asc" | "desc" },
): Promise<Photo[]> {
	const allPhotos = await prisma.photo.findMany({
		where: { ...basePhotoWhere(), ...where },
		orderBy,
	});

	// Filter by candidate set in JS (mock-safe, and dataset is small in tests).
	const filtered = allPhotos.filter((p) => candidatePhotoIds.has(p.id));

	return filtered.slice(skip, skip + take);
}

export async function countPublicPhotos(
	candidatePhotoIds: Set<string>,
	where: PublicPhotoWhere,
): Promise<number> {
	const allPhotos = await prisma.photo.findMany({
		where: { ...basePhotoWhere(), ...where },
	});

	return allPhotos.filter((p) => candidatePhotoIds.has(p.id)).length;
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