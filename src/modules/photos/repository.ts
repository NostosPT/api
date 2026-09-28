import { Prisma, type Photo, type PhotoStatus, type UploadStatus, type Visibility, type Availability } from "@prisma/client";
import { prisma } from "../../db/prisma.js";
import { ConflictError } from "../../errors/appError.js";

export interface CreatePhotoInput {
	originalKey: string;
	title?: string | null;
	description?: string | null;
	width?: number | null;
	height?: number | null;
	takenAt?: Date | null;
	location?: string | null;
	visibility?: Visibility;
	availability?: Availability;
	priceCents?: number | null;
	currency?: string;
	photographerId?: string | null;
	uploadStatus?: UploadStatus;
	status?: PhotoStatus;
}

// undefined = leave unchanged, null = clear (PATCH semantics without Prisma
// FieldUpdates so the mock and Prisma behave identically).
export type UpdatePhotoInput = Omit<CreatePhotoInput, "originalKey">;

export interface ListPhotosWhere {
	status?: PhotoStatus;
	visibility?: Visibility;
	availability?: Availability;
	uploadStatus?: UploadStatus | { not: UploadStatus };
	photographerId?: string;
	OR?: Prisma.PhotoWhereInput[];
}

function translateConflict(error: unknown): never {
	if (error instanceof Error && "code" in error && error.code === "P2002") {
		throw new ConflictError("Photo already exists");
	}

	throw error;
}

export async function findPhotoById(id: string): Promise<Photo | null> {
	return prisma.photo.findUnique({ where: { id } });
}

export async function findPhotoByOriginalKey(originalKey: string): Promise<Photo | null> {
	return prisma.photo.findUnique({ where: { originalKey } });
}

export async function listPhotos(where: ListPhotosWhere, skip: number, take: number): Promise<Photo[]> {
	return prisma.photo.findMany({ where: where as Prisma.PhotoWhereInput, orderBy: { createdAt: "desc" }, skip, take });
}

export async function countPhotos(where: ListPhotosWhere): Promise<number> {
	return prisma.photo.count({ where: where as Prisma.PhotoWhereInput });
}

export async function createPhoto(input: CreatePhotoInput): Promise<Photo> {
	try {
		return await prisma.photo.create({
			data: {
				originalKey: input.originalKey,
				title: input.title ?? null,
				description: input.description ?? null,
				width: input.width ?? null,
				height: input.height ?? null,
				takenAt: input.takenAt ?? null,
				location: input.location ?? null,
				visibility: input.visibility ?? "PRIVATE",
				availability: input.availability ?? "NOT_FOR_SALE",
				priceCents: input.priceCents ?? null,
				currency: input.currency ?? "EUR",
				photographerId: input.photographerId ?? null,
				uploadStatus: input.uploadStatus ?? "PENDING",
				status: input.status ?? "DRAFT",
			},
		});
	}
	catch (error) {
		translateConflict(error);
	}
}

export async function updatePhoto(id: string, input: UpdatePhotoInput): Promise<Photo> {
	const data: Prisma.PhotoUncheckedUpdateInput = {};

	if (input.title !== undefined) {
		data.title = input.title;
	}
	if (input.description !== undefined) {
		data.description = input.description;
	}
	if (input.width !== undefined) {
		data.width = input.width;
	}
	if (input.height !== undefined) {
		data.height = input.height;
	}
	if (input.takenAt !== undefined) {
		data.takenAt = input.takenAt;
	}
	if (input.location !== undefined) {
		data.location = input.location;
	}
	if (input.visibility !== undefined) {
		data.visibility = input.visibility;
	}
	if (input.availability !== undefined) {
		data.availability = input.availability;
	}
	if (input.priceCents !== undefined) {
		data.priceCents = input.priceCents;
	}
	if (input.currency !== undefined) {
		data.currency = input.currency;
	}
	if (input.photographerId !== undefined) {
		data.photographerId = input.photographerId;
	}
	if (input.uploadStatus !== undefined) {
		data.uploadStatus = input.uploadStatus;
	}
	if (input.status !== undefined) {
		data.status = input.status;
	}

	try {
		return await prisma.photo.update({ where: { id }, data });
	}
	catch (error) {
		translateConflict(error);
	}
}

export async function referenceCounts(photoId: string): Promise<{ album: number; gallery: number; purchase: number }> {
	const [album, gallery, purchase] = await Promise.all([
		prisma.albumPhoto.count({ where: { photoId } }),
		prisma.galleryPhoto.count({ where: { photoId } }),
		prisma.purchasePhoto.count({ where: { photoId } }),
	]);

	return { album, gallery, purchase };
}

export async function deletePhoto(id: string): Promise<void> {
	try {
		await prisma.photo.delete({ where: { id } });
	}
	catch (error) {
		if (error instanceof Error && "code" in error && error.code === "P2003") {
			throw new ConflictError("Photo is referenced by albums, galleries or purchases");
		}

		throw error;
	}
}

function isP2002(error: unknown): boolean {
	return (
		(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") ||
		(typeof error === "object" && error !== null && "code" in error && (error as { code: unknown }).code === "P2002")
	);
}

export async function findCategoryById(id: string): Promise<{ id: string } | null> {
	return prisma.category.findUnique({ where: { id }, select: { id: true } });
}

export async function findTagById(id: string): Promise<{ id: string } | null> {
	return prisma.tag.findUnique({ where: { id }, select: { id: true } });
}

export async function addPhotoCategory(photoId: string, categoryId: string): Promise<void> {
	try {
		await prisma.photoCategory.create({ data: { photoId, categoryId } });
	}
	catch (error) {
		if (isP2002(error)) {
			// Already assigned - idempotent
			return;
		}
		throw error;
	}
}

export async function removePhotoCategory(photoId: string, categoryId: string): Promise<void> {
	await prisma.photoCategory.deleteMany({ where: { photoId, categoryId } });
}

export async function addPhotoTag(photoId: string, tagId: string): Promise<void> {
	try {
		await prisma.photoTag.create({ data: { photoId, tagId } });
	}
	catch (error) {
		if (isP2002(error)) {
			// Already assigned - idempotent
			return;
		}
		throw error;
	}
}

export async function removePhotoTag(photoId: string, tagId: string): Promise<void> {
	await prisma.photoTag.deleteMany({ where: { photoId, tagId } });
}

export async function listPhotoCategories(photoId: string): Promise<{ categoryId: string }[]> {
	return prisma.photoCategory.findMany({ where: { photoId }, select: { categoryId: true } });
}

export async function listPhotoTags(photoId: string): Promise<{ tagId: string }[]> {
	return prisma.photoTag.findMany({ where: { photoId }, select: { tagId: true } });
}
