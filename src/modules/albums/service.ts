import { randomBytes } from "node:crypto";
import { hashPassword } from "../../auth/password.js";
import { logAudit } from "../../audit/log.js";
import { findClientById } from "../clients/repository.js";
import { ConflictError, NotFoundError, ValidationError } from "../../errors/appError.js";
import { findPhotoById } from "../photos/repository.js";
import { toAlbumDTO, type AlbumDetailDTO, type AlbumList } from "./dto.js";
import {
	countAlbums,
	createAlbum,
	findAlbumById,
	findAlbumBySlug,
	findPhotosByIds,
	findTagById,
	addAlbumTag as repoAddAlbumTag,
	removeAlbumTag as repoRemoveAlbumTag,
	getAlbumPhotoIds,
	listAlbums,
	replaceAlbumPhotos,
	updateAlbum,
	updateAlbumPhotoMembership,
	type ListAlbumsWhere,
	type UpdateAlbumInput,
} from "./repository.js";
import type { CreateAlbumBody, ListAlbumsQuery, SetAlbumPhotosBody, UpdateAlbumBody } from "./schemas.js";

function slugifyTitle(title: string): string {
	const base = title
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 48);

	return base === "" ? "album" : base;
}

// Unguessable default: readable prefix plus a random suffix (schema: slug is
// the access-link identifier, never the sole secret).
function generateSlug(title: string): string {
	return `${slugifyTitle(title)}-${randomBytes(3).toString("hex")}`;
}

function parseIsoDate(value: string | null): Date | null {
	if (value === null) {
		return null;
	}

	const parsed = new Date(value);

	if (Number.isNaN(parsed.getTime())) {
		throw new ValidationError("expiresAt is not a valid date");
	}

	return parsed;
}

async function getAlbumOrThrow(id: string) {
	const album = await findAlbumById(id);

	if (album === null) {
		throw new NotFoundError("Album not found");
	}

	return album;
}

async function toAlbumDetail(id: string): Promise<AlbumDetailDTO> {
	const album = await getAlbumOrThrow(id);
	const photoIds = await getAlbumPhotoIds(id);

	return { ...toAlbumDTO(album), photoIds };
}

export interface AlbumFilters {
	clientId?: string;
	status?: ListAlbumsQuery["status"];
	type?: ListAlbumsQuery["type"];
	q?: string;
}

export async function listAllAlbums(page: number, pageSize: number, filters: AlbumFilters = {}): Promise<AlbumList> {
	const where: ListAlbumsWhere = {
		// Archived albums are hidden unless explicitly requested (clients precedent).
		status: filters.status ?? { not: "ARCHIVED" },
		...(filters.clientId === undefined ? {} : { clientId: filters.clientId }),
		...(filters.type === undefined ? {} : { type: filters.type }),
		...(filters.q === undefined
			? {}
			: { OR: [{ title: { contains: filters.q, mode: "insensitive" } }] }),
	};

	const [items, total] = await Promise.all([
		listAlbums(where, (page - 1) * pageSize, pageSize),
		countAlbums(where),
	]);

	return { items: items.map(toAlbumDTO), page, pageSize, total };
}

export async function getAlbum(id: string): Promise<AlbumDetailDTO> {
	return toAlbumDetail(id);
}

export async function createAlbumRecord(actorId: string, input: CreateAlbumBody): Promise<AlbumDetailDTO> {
	const client = await findClientOrThrow(input.clientId);

	if (input.coverPhotoId !== undefined && input.coverPhotoId !== null) {
		await findPhotoOrThrow(input.coverPhotoId);
	}

	const slug = input.slug ?? generateSlug(input.title);

	const existingSlug = await findAlbumBySlug(slug);

	if (existingSlug !== null) {
		throw new ConflictError("Album slug already exists");
	}

	const album = await createAlbum({
		clientId: client.id,
		slug,
		title: input.title.trim(),
		...(input.description === undefined ? {} : { description: input.description.trim() }),
		type: input.type,
		...(input.priceCents === undefined ? {} : { priceCents: input.priceCents }),
		...(input.packPriceCents === undefined ? {} : { packPriceCents: input.packPriceCents }),
		...(input.packSize === undefined ? {} : { packSize: input.packSize }),
		...(input.currency === undefined ? {} : { currency: input.currency }),
		...(input.coverPhotoId === undefined ? {} : { coverPhotoId: input.coverPhotoId }),
		expiresAt: input.expiresAt === undefined ? null : parseIsoDate(input.expiresAt),
	});

	await logAudit({
		actorId,
		action: "albums.create",
		resourceType: "album",
		resourceId: album.id,
		result: "SUCCESS",
		metadata: { clientId: album.clientId, slug: album.slug, type: album.type },
	});

	return { ...toAlbumDTO(album), photoIds: [] };
}

export async function updateAlbumRecord(
	actorId: string,
	id: string,
	patch: UpdateAlbumBody,
): Promise<AlbumDetailDTO> {
	await getAlbumOrThrow(id);

	if (patch.coverPhotoId !== undefined && patch.coverPhotoId !== null) {
		await findPhotoOrThrow(patch.coverPhotoId);
	}

	const next: UpdateAlbumInput = {
		...(patch.title === undefined ? {} : { title: patch.title.trim() }),
		...(patch.description === undefined ? {} : { description: patch.description === null ? null : patch.description.trim() }),
		...(patch.type === undefined ? {} : { type: patch.type }),
		...(patch.priceCents === undefined ? {} : { priceCents: patch.priceCents }),
		...(patch.packPriceCents === undefined ? {} : { packPriceCents: patch.packPriceCents }),
		...(patch.packSize === undefined ? {} : { packSize: patch.packSize }),
		...(patch.currency === undefined ? {} : { currency: patch.currency }),
		...(patch.coverPhotoId === undefined ? {} : { coverPhotoId: patch.coverPhotoId }),
		...(patch.expiresAt === undefined ? {} : { expiresAt: parseIsoDate(patch.expiresAt) }),
	};

	await updateAlbum(id, next);

	await logAudit({
		actorId,
		action: "albums.update",
		resourceType: "album",
		resourceId: id,
		result: "SUCCESS",
		metadata: {
			...(patch.type === undefined ? {} : { type: patch.type }),
			...(patch.coverPhotoId === undefined ? {} : { coverPhotoId: patch.coverPhotoId }),
			...(patch.expiresAt === undefined ? {} : { expiresAt: patch.expiresAt }),
		},
	});

	return toAlbumDetail(id);
}

export async function publishAlbum(actorId: string, id: string): Promise<AlbumDetailDTO> {
	const album = await getAlbumOrThrow(id);

	if (album.status === "ARCHIVED") {
		throw new ValidationError("Archived album cannot be published");
	}

	if (album.status === "PUBLISHED") {
		throw new ValidationError("Album is already published");
	}

	// DECISIONS.md: published WATERMARK/PAID albums require an access code;
	// FREE published albums use the capability link alone.
	if ((album.type === "WATERMARK" || album.type === "PAID") && album.accessCodeHash === null) {
		throw new ValidationError("Access code required for published albums");
	}

	await updateAlbum(id, { status: "PUBLISHED", publishedAt: new Date() });

	await logAudit({
		actorId,
		action: "albums.publish",
		resourceType: "album",
		resourceId: id,
		result: "SUCCESS",
		metadata: { from: "DRAFT", to: "PUBLISHED" },
	});

	return toAlbumDetail(id);
}

export async function unpublishAlbum(actorId: string, id: string): Promise<AlbumDetailDTO> {
	const album = await getAlbumOrThrow(id);

	if (album.status !== "PUBLISHED") {
		throw new ValidationError("Album is not published");
	}

	await updateAlbum(id, { status: "DRAFT", publishedAt: null });

	await logAudit({
		actorId,
		action: "albums.unpublish",
		resourceType: "album",
		resourceId: id,
		result: "SUCCESS",
		metadata: { from: "PUBLISHED", to: "DRAFT" },
	});

	return toAlbumDetail(id);
}

// Phase 1 offers archive instead of hard deletion (REQUIREMENTS §2:
// deletion with history archives via status -> ARCHIVED).
export async function archiveAlbum(actorId: string, id: string): Promise<void> {
	const album = await getAlbumOrThrow(id);

	if (album.status === "ARCHIVED") {
		throw new ConflictError("Album is already archived");
	}

	await updateAlbum(id, { status: "ARCHIVED" });

	await logAudit({
		actorId,
		action: "albums.archive",
		resourceType: "album",
		resourceId: id,
		result: "SUCCESS",
		metadata: { from: album.status, to: "ARCHIVED" },
	});
}

// Bumps Album.secretVersion, revoking every outstanding capability link at once.
export async function rotateAlbum(actorId: string, id: string): Promise<{ status: string; secretVersion: number }> {
	const album = await getAlbumOrThrow(id);
	const secretVersion = album.secretVersion + 1;

	await updateAlbum(id, { secretVersion });

	await logAudit({
		actorId,
		action: "albums.rotate",
		resourceType: "album",
		resourceId: id,
		result: "SUCCESS",
		metadata: { secretVersion },
	});

	return { status: "rotated", secretVersion };
}

export async function setAccessCode(
	actorId: string,
	id: string,
	code: string,
): Promise<{ status: string }> {
	await getAlbumOrThrow(id);
	const accessCodeHash = await hashPassword(code);

	await updateAlbum(id, { accessCodeHash });

	await logAudit({
		actorId,
		action: "albums.access.set",
		resourceType: "album",
		resourceId: id,
		result: "SUCCESS",
		metadata: null,
	});

	return { status: "set" };
}

export async function clearAccessCode(actorId: string, id: string): Promise<{ status: string }> {
	const album = await getAlbumOrThrow(id);

	if (album.status === "PUBLISHED" && (album.type === "WATERMARK" || album.type === "PAID")) {
		throw new ValidationError("Access code required for published albums");
	}

	await updateAlbum(id, { accessCodeHash: null });

	await logAudit({
		actorId,
		action: "albums.access.clear",
		resourceType: "album",
		resourceId: id,
		result: "SUCCESS",
		metadata: null,
	});

	return { status: "cleared" };
}

export async function setAlbumPhotos(
	actorId: string,
	id: string,
	input: SetAlbumPhotosBody,
): Promise<AlbumDetailDTO> {
	const album = await getAlbumOrThrow(id);

	// Dense positions require uniqueness: first occurrence wins.
	const photoIds = [...new Set(input.photoIds)];

	const existing = await findPhotosByIds(photoIds);
	const existingIds = new Set(existing.map((photo) => photo.id));
	const missing = photoIds.filter((photoId) => !existingIds.has(photoId));

	if (missing.length > 0) {
		throw new ValidationError("One or more photos do not exist");
	}

	await replaceAlbumPhotos(id, photoIds);

	if (album.coverPhotoId !== null && !photoIds.includes(album.coverPhotoId)) {
		await updateAlbum(id, { coverPhotoId: null });
	}

	await logAudit({
		actorId,
		action: "albums.photos.set",
		resourceType: "album",
		resourceId: id,
		result: "SUCCESS",
		metadata: { count: photoIds.length },
	});

	return toAlbumDetail(id);
}

export async function updateAlbumPhotoRecord(
	actorId: string,
	id: string,
	photoId: string,
	isPreview: boolean,
): Promise<AlbumDetailDTO> {
	await getAlbumOrThrow(id);

	const updated = await updateAlbumPhotoMembership(id, photoId, isPreview);

	if (!updated) {
		throw new NotFoundError("Photo is not in this album");
	}

	await logAudit({
		actorId,
		action: "albums.photos.update",
		resourceType: "album",
		resourceId: id,
		result: "SUCCESS",
		metadata: { photoId, isPreview },
	});

	return toAlbumDetail(id);
}

export async function addAlbumTag(
	actorId: string,
	albumId: string,
	tagId: string,
): Promise<void> {
	const tag = await findTagById(tagId);

	if (tag === null) {
		throw new NotFoundError("Tag not found");
	}

	await repoAddAlbumTag(albumId, tagId);

	await logAudit({
		actorId,
		action: "albums.tags.add",
		resourceType: "album",
		resourceId: albumId,
		result: "SUCCESS",
		metadata: { tagId },
	});
}

export async function removeAlbumTag(
	actorId: string,
	albumId: string,
	tagId: string,
): Promise<void> {
	const tag = await findTagById(tagId);

	if (tag === null) {
		throw new NotFoundError("Tag not found");
	}

	await repoRemoveAlbumTag(albumId, tagId);

	await logAudit({
		actorId,
		action: "albums.tags.remove",
		resourceType: "album",
		resourceId: albumId,
		result: "SUCCESS",
		metadata: { tagId },
	});
}

async function findClientOrThrow(clientId: string) {
	const client = await findClientById(clientId);

	if (client === null) {
		throw new NotFoundError("Client not found");
	}

	return client;
}

async function findPhotoOrThrow(photoId: string) {
	const photo = await findPhotoById(photoId);

	if (photo === null) {
		throw new NotFoundError("Photo not found");
	}

	return photo;
}
