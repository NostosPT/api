import { randomBytes } from "node:crypto";
import { logAudit } from "../../audit/log.js";
import { ConflictError, NotFoundError, ValidationError } from "../../errors/appError.js";
import { toGalleryDTO, type GalleryDetailDTO, type GalleryList } from "./dto.js";
import {
	countGalleries,
	createGallery,
	findGalleryById,
	findGalleryByPosition,
	findGalleryBySlug,
	findPhotosByIds,
	getGalleryEntries,
	listGalleries,
	replaceGalleryPhotos,
	updateGallery,
	updateGalleryPhotoMembership,
	type ListGalleriesWhere,
	type UpdateGalleryInput,
} from "./repository.js";
import type { CreateGalleryBody, ListGalleriesQuery, SetGalleryPhotosBody, UpdateGalleryBody } from "./schemas.js";

function slugifyTitle(title: string): string {
	const base = title
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 48);

	return base === "" ? "gallery" : base;
}

// Public identifier (schema: "guessable OK") — still unique per collection.
function generateSlug(title: string): string {
	return `${slugifyTitle(title)}-${randomBytes(3).toString("hex")}`;
}

async function getGalleryOrThrow(id: string) {
	const gallery = await findGalleryById(id);

	if (gallery === null) {
		throw new NotFoundError("Gallery not found");
	}

	return gallery;
}

async function toGalleryDetail(id: string): Promise<GalleryDetailDTO> {
	const gallery = await getGalleryOrThrow(id);
	const entries = await getGalleryEntries(id);

	return { ...toGalleryDTO(gallery), entries };
}

export interface GalleryFilters {
	status?: ListGalleriesQuery["status"];
	q?: string;
}

export async function listAllGalleries(
	page: number,
	pageSize: number,
	filters: GalleryFilters = {},
): Promise<GalleryList> {
	const where: ListGalleriesWhere = {
		// Archived galleries are hidden unless explicitly requested (albums precedent).
		status: filters.status ?? { not: "ARCHIVED" },
		...(filters.q === undefined
			? {}
			: { OR: [{ title: { contains: filters.q, mode: "insensitive" } }] }),
	};

	const [items, total] = await Promise.all([
		listGalleries(where, (page - 1) * pageSize, pageSize),
		countGalleries(where),
	]);

	return { items: items.map(toGalleryDTO), page, pageSize, total };
}

export async function getGallery(id: string): Promise<GalleryDetailDTO> {
	return toGalleryDetail(id);
}

async function assertPositionFree(position: number | null | undefined, excludeId?: string): Promise<void> {
	if (position === null || position === undefined) {
		return;
	}

	const existing = await findGalleryByPosition(position);

	if (existing !== null && existing.id !== excludeId) {
		throw new ConflictError("Gallery position already exists");
	}
}

export async function createGalleryRecord(actorId: string, input: CreateGalleryBody): Promise<GalleryDetailDTO> {
	const slug = input.slug ?? generateSlug(input.title);

	const existingSlug = await findGalleryBySlug(slug);

	if (existingSlug !== null) {
		throw new ConflictError("Gallery slug already exists");
	}

	await assertPositionFree(input.position);

	const gallery = await createGallery({
		slug,
		title: input.title.trim(),
		...(input.description === undefined ? {} : { description: input.description.trim() }),
		...(input.position === undefined ? {} : { position: input.position }),
	});

	await logAudit({
		actorId,
		action: "galleries.create",
		resourceType: "gallery",
		resourceId: gallery.id,
		result: "SUCCESS",
		metadata: { slug: gallery.slug, title: gallery.title },
	});

	return { ...toGalleryDTO(gallery), entries: [] };
}

export async function updateGalleryRecord(
	actorId: string,
	id: string,
	patch: UpdateGalleryBody,
): Promise<GalleryDetailDTO> {
	await getGalleryOrThrow(id);

	if (patch.position !== undefined) {
		await assertPositionFree(patch.position, id);
	}

	const next: UpdateGalleryInput = {
		...(patch.title === undefined ? {} : { title: patch.title.trim() }),
		...(patch.description === undefined
			? {}
			: { description: patch.description === null ? null : patch.description.trim() }),
		...(patch.position === undefined ? {} : { position: patch.position }),
	};

	await updateGallery(id, next);

	await logAudit({
		actorId,
		action: "galleries.update",
		resourceType: "gallery",
		resourceId: id,
		result: "SUCCESS",
		metadata: {
			...(patch.title === undefined ? {} : { title: patch.title }),
			...(patch.position === undefined ? {} : { position: patch.position }),
		},
	});

	return toGalleryDetail(id);
}

export async function publishGallery(actorId: string, id: string): Promise<GalleryDetailDTO> {
	const gallery = await getGalleryOrThrow(id);

	if (gallery.status === "ARCHIVED") {
		throw new ValidationError("Archived gallery cannot be published");
	}

	if (gallery.status === "PUBLISHED") {
		throw new ValidationError("Gallery is already published");
	}

	await updateGallery(id, { status: "PUBLISHED" });

	await logAudit({
		actorId,
		action: "galleries.publish",
		resourceType: "gallery",
		resourceId: id,
		result: "SUCCESS",
		metadata: { from: "DRAFT", to: "PUBLISHED" },
	});

	return toGalleryDetail(id);
}

export async function unpublishGallery(actorId: string, id: string): Promise<GalleryDetailDTO> {
	const gallery = await getGalleryOrThrow(id);

	if (gallery.status !== "PUBLISHED") {
		throw new ValidationError("Gallery is not published");
	}

	await updateGallery(id, { status: "DRAFT" });

	await logAudit({
		actorId,
		action: "galleries.unpublish",
		resourceType: "gallery",
		resourceId: id,
		result: "SUCCESS",
		metadata: { from: "PUBLISHED", to: "DRAFT" },
	});

	return toGalleryDetail(id);
}

// Phase 1 offers archive instead of hard deletion (albums precedent).
export async function archiveGallery(actorId: string, id: string): Promise<void> {
	const gallery = await getGalleryOrThrow(id);

	if (gallery.status === "ARCHIVED") {
		throw new ConflictError("Gallery is already archived");
	}

	await updateGallery(id, { status: "ARCHIVED" });

	await logAudit({
		actorId,
		action: "galleries.archive",
		resourceType: "gallery",
		resourceId: id,
		result: "SUCCESS",
		metadata: { from: gallery.status, to: "ARCHIVED" },
	});
}

export async function setGalleryPhotos(
	actorId: string,
	id: string,
	input: SetGalleryPhotosBody,
): Promise<GalleryDetailDTO> {
	await getGalleryOrThrow(id);

	// Dense positions require uniqueness: first occurrence wins.
	const photoIds = [...new Set(input.photoIds)];

	const existing = await findPhotosByIds(photoIds);
	const existingIds = new Set(existing.map((photo) => photo.id));
	const missing = photoIds.filter((photoId) => !existingIds.has(photoId));

	if (missing.length > 0) {
		throw new ValidationError("One or more photos do not exist");
	}

	await replaceGalleryPhotos(id, photoIds);

	await logAudit({
		actorId,
		action: "galleries.photos.set",
		resourceType: "gallery",
		resourceId: id,
		result: "SUCCESS",
		metadata: { count: photoIds.length },
	});

	return toGalleryDetail(id);
}

export async function updateGalleryPhotoRecord(
	actorId: string,
	id: string,
	photoId: string,
	isFeatured: boolean,
): Promise<GalleryDetailDTO> {
	await getGalleryOrThrow(id);

	const updated = await updateGalleryPhotoMembership(id, photoId, isFeatured);

	if (!updated) {
		throw new NotFoundError("Photo is not in this gallery");
	}

	await logAudit({
		actorId,
		action: "galleries.photos.update",
		resourceType: "gallery",
		resourceId: id,
		result: "SUCCESS",
		metadata: { photoId, isFeatured },
	});

	return toGalleryDetail(id);
}
