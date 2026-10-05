import { Prisma, type Album, type AlbumStatus, type AlbumType } from "@prisma/client";
import { prisma } from "../../db/prisma.js";
import { ConflictError } from "../../errors/appError.js";

function isP2002(error: unknown): boolean {
	return (
		(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") ||
		(typeof error === "object" && error !== null && "code" in error && (error as { code: unknown }).code === "P2002")
	);
}

export interface CreateAlbumInput {
	clientId: string;
	slug: string;
	title: string;
	description?: string | null;
	type: AlbumType;
	priceCents?: number | null;
	packPriceCents?: number | null;
	packSize?: number | null;
	currency?: string;
	coverPhotoId?: string | null;
	expiresAt?: Date | null;
}

// undefined = leave unchanged, null = clear (PATCH semantics without Prisma
// FieldUpdates so the mock and Prisma behave identically).
export interface UpdateAlbumInput {
	title?: string;
	description?: string | null;
	type?: AlbumType;
	priceCents?: number | null;
	packPriceCents?: number | null;
	packSize?: number | null;
	currency?: string;
	coverPhotoId?: string | null;
	expiresAt?: Date | null;
	status?: AlbumStatus;
	publishedAt?: Date | null;
	secretVersion?: number;
	accessCodeHash?: string | null;
}

export interface ListAlbumsWhere {
	clientId?: string;
	status?: AlbumStatus | { not: AlbumStatus };
	type?: AlbumType;
	OR?: Prisma.AlbumWhereInput[];
}

function translateConflict(error: unknown): never {
	if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
		throw new ConflictError("Album slug already exists");
	}

	throw error;
}

export async function findAlbumById(id: string): Promise<Album | null> {
	return prisma.album.findUnique({ where: { id } });
}

export async function findAlbumBySlug(slug: string): Promise<Album | null> {
	return prisma.album.findUnique({ where: { slug } });
}

export async function listAlbums(where: ListAlbumsWhere, skip: number, take: number): Promise<Album[]> {
	return prisma.album.findMany({ where: where as Prisma.AlbumWhereInput, orderBy: { createdAt: "desc" }, skip, take });
}

export async function countAlbums(where: ListAlbumsWhere): Promise<number> {
	return prisma.album.count({ where: where as Prisma.AlbumWhereInput });
}

export async function createAlbum(input: CreateAlbumInput): Promise<Album> {
	try {
		return await prisma.album.create({
			data: {
				clientId: input.clientId,
				slug: input.slug,
				title: input.title,
				description: input.description ?? null,
				type: input.type,
				// Schema defaults the mock does not fill itself.
				status: "DRAFT",
				secretVersion: 1,
				views: 0,
				priceCents: input.priceCents ?? null,
				packPriceCents: input.packPriceCents ?? null,
				packSize: input.packSize ?? null,
				currency: input.currency ?? "EUR",
				coverPhotoId: input.coverPhotoId ?? null,
				expiresAt: input.expiresAt ?? null,
			},
		});
	}
	catch (error) {
		translateConflict(error);
	}
}

export async function updateAlbum(id: string, input: UpdateAlbumInput): Promise<Album> {
	const data: Prisma.AlbumUncheckedUpdateInput = {};

	if (input.title !== undefined) {
		data.title = input.title;
	}
	if (input.description !== undefined) {
		data.description = input.description;
	}
	if (input.type !== undefined) {
		data.type = input.type;
	}
	if (input.priceCents !== undefined) {
		data.priceCents = input.priceCents;
	}
	if (input.packPriceCents !== undefined) {
		data.packPriceCents = input.packPriceCents;
	}
	if (input.packSize !== undefined) {
		data.packSize = input.packSize;
	}
	if (input.currency !== undefined) {
		data.currency = input.currency;
	}
	if (input.coverPhotoId !== undefined) {
		data.coverPhotoId = input.coverPhotoId;
	}
	if (input.expiresAt !== undefined) {
		data.expiresAt = input.expiresAt;
	}
	if (input.status !== undefined) {
		data.status = input.status;
	}
	if (input.publishedAt !== undefined) {
		data.publishedAt = input.publishedAt;
	}
	if (input.secretVersion !== undefined) {
		data.secretVersion = input.secretVersion;
	}
	if (input.accessCodeHash !== undefined) {
		data.accessCodeHash = input.accessCodeHash;
	}

	try {
		return await prisma.album.update({ where: { id }, data });
	}
	catch (error) {
		translateConflict(error);
	}
}

export async function getAlbumPhotoIds(albumId: string): Promise<string[]> {
	const rows = await prisma.albumPhoto.findMany({ where: { albumId }, orderBy: { position: "asc" } });

	return rows.map((row) => row.photoId);
}

export async function findPhotosByIds(ids: string[]): Promise<{ id: string }[]> {
	if (ids.length === 0) {
		return [];
	}

	return prisma.photo.findMany({ where: { id: { in: ids } }, select: { id: true } });
}

// Full replacement keeps positions dense (1..n) as the schema requires.
// One multi-row INSERT keeps the transaction short regardless of album size.
export async function replaceAlbumPhotos(albumId: string, photoIds: string[]): Promise<void> {
	await prisma.$transaction(async (tx) => {
		await tx.albumPhoto.deleteMany({ where: { albumId } });
		await tx.albumPhoto.createMany({
			data: photoIds.map((photoId, index) => ({ albumId, photoId, position: index + 1, isPreview: true })),
		});
	});
}

export async function updateAlbumPhotoMembership(
	albumId: string,
	photoId: string,
	isPreview: boolean,
): Promise<boolean> {
	// updateMany avoids the compound-key where shape the mock cannot match.
	const result = await prisma.albumPhoto.updateMany({
		where: { albumId, photoId },
		data: { isPreview },
	});

	return result.count > 0;
}

export async function findTagById(id: string): Promise<{ id: string } | null> {
	return prisma.tag.findUnique({ where: { id }, select: { id: true } });
}

export async function addAlbumTag(albumId: string, tagId: string): Promise<void> {
	try {
		await prisma.albumTag.create({ data: { albumId, tagId } });
	}
	catch (error) {
		if (isP2002(error)) {
			// Already assigned - idempotent
			return;
		}
		throw error;
	}
}

export async function removeAlbumTag(albumId: string, tagId: string): Promise<void> {
	await prisma.albumTag.deleteMany({ where: { albumId, tagId } });
}

export async function listAlbumTags(albumId: string): Promise<{ tagId: string }[]> {
	return prisma.albumTag.findMany({ where: { albumId }, select: { tagId: true } });
}
