import { Prisma, type Gallery, type GalleryStatus } from "@prisma/client";
import { prisma } from "../../db/prisma.js";
import { ConflictError } from "../../errors/appError.js";

export interface CreateGalleryInput {
	slug: string;
	title: string;
	description?: string | null;
	position?: number | null;
}

// undefined = leave unchanged, null = clear (PATCH semantics without Prisma
// FieldUpdates so the mock and Prisma behave identically).
export interface UpdateGalleryInput {
	title?: string;
	description?: string | null;
	position?: number | null;
	status?: GalleryStatus;
}

export interface ListGalleriesWhere {
	status?: GalleryStatus | { not: GalleryStatus };
	OR?: Prisma.GalleryWhereInput[];
}

function translateConflict(error: unknown): never {
	if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
		throw new ConflictError("Gallery slug or position already exists");
	}

	throw error;
}

export async function findGalleryById(id: string): Promise<Gallery | null> {
	return prisma.gallery.findUnique({ where: { id } });
}

export async function findGalleryBySlug(slug: string): Promise<Gallery | null> {
	return prisma.gallery.findUnique({ where: { slug } });
}

export async function findGalleryByPosition(position: number): Promise<Gallery | null> {
	return prisma.gallery.findFirst({ where: { position } });
}

export async function listGalleries(where: ListGalleriesWhere, skip: number, take: number): Promise<Gallery[]> {
	return prisma.gallery.findMany({
		where: where as Prisma.GalleryWhereInput,
		orderBy: { createdAt: "desc" },
		skip,
		take,
	});
}

export async function countGalleries(where: ListGalleriesWhere): Promise<number> {
	return prisma.gallery.count({ where: where as Prisma.GalleryWhereInput });
}

export async function createGallery(input: CreateGalleryInput): Promise<Gallery> {
	try {
		return await prisma.gallery.create({
			data: {
				slug: input.slug,
				title: input.title,
				description: input.description ?? null,
				position: input.position ?? null,
				// Schema default the mock does not fill itself.
				status: "DRAFT",
			},
		});
	}
	catch (error) {
		translateConflict(error);
	}
}

export async function updateGallery(id: string, input: UpdateGalleryInput): Promise<Gallery> {
	const data: Prisma.GalleryUncheckedUpdateInput = {};

	if (input.title !== undefined) {
		data.title = input.title;
	}
	if (input.description !== undefined) {
		data.description = input.description;
	}
	if (input.position !== undefined) {
		data.position = input.position;
	}
	if (input.status !== undefined) {
		data.status = input.status;
	}

	try {
		return await prisma.gallery.update({ where: { id }, data });
	}
	catch (error) {
		translateConflict(error);
	}
}

export async function getGalleryEntries(
	galleryId: string,
): Promise<{ photoId: string; position: number; isFeatured: boolean }[]> {
	const rows = await prisma.galleryPhoto.findMany({ where: { galleryId }, orderBy: { position: "asc" } });

	return rows.map((row) => ({ photoId: row.photoId, position: row.position, isFeatured: row.isFeatured }));
}

export async function findPhotosByIds(ids: string[]): Promise<{ id: string }[]> {
	if (ids.length === 0) {
		return [];
	}

	return prisma.photo.findMany({ where: { id: { in: ids } }, select: { id: true } });
}

// Full replacement keeps positions dense (1..n) as the schema requires.
// One multi-row INSERT keeps the transaction short regardless of gallery size.
export async function replaceGalleryPhotos(galleryId: string, photoIds: string[]): Promise<void> {
	await prisma.$transaction(async (tx) => {
		await tx.galleryPhoto.deleteMany({ where: { galleryId } });
		await tx.galleryPhoto.createMany({
			data: photoIds.map((photoId, index) => ({ galleryId, photoId, position: index + 1, isFeatured: false })),
		});
	});
}

export async function updateGalleryPhotoMembership(
	galleryId: string,
	photoId: string,
	isFeatured: boolean,
): Promise<boolean> {
	// updateMany avoids the compound-key where shape the mock cannot match.
	const result = await prisma.galleryPhoto.updateMany({
		where: { galleryId, photoId },
		data: { isFeatured },
	});

	return result.count > 0;
}
