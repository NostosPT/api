import { randomUUID } from "node:crypto";
import { basename, extname } from "node:path";
import type { Photo } from "@prisma/client";
import { logAudit } from "../../audit/log.js";
import type { AuthenticatedUser } from "../../auth/session.js";
import { config } from "../../config/index.js";
import { AuthorizationError, ConflictError, NotFoundError, ServiceUnavailableError, ValidationError } from "../../errors/appError.js";
import { storage } from "../../storage/index.js";
import { toPhotoDTO, type PhotoDTO, type PhotoList, type UploadIntent } from "./dto.js";
import {
	countPhotos,
	createPhoto,
	deletePhoto,
	findPhotoById,
	findPhotoByOriginalKey,
	listPhotos,
	referenceCounts,
	updatePhoto,
	type ListPhotosWhere,
	type UpdatePhotoInput,
} from "./repository.js";
import type { CreatePhotoBody, CreateUploadBody, ListPhotosQuery, UpdatePhotoBody } from "./schemas.js";

const ALLOWED_CONTENT_TYPES = new Set([
	"image/jpeg",
	"image/png",
	"image/webp",
	// Camera RAWs arrive without a MIME type from the browser.
	"application/octet-stream",
]);

const ALLOWED_EXTENSIONS = new Set([
	".jpg",
	".jpeg",
	".png",
	".webp",
	".cr2",
	".cr3",
	".nef",
	".arw",
	".dng",
	".raf",
	".orf",
	".rw2",
]);

// Hand-checked magic bytes (no file-type dependency): JPEG, PNG, RIFF/WEBP,
// TIFF (covers CR2/NEF/ARW/DNG/ORF/RW2 containers) and Fuji RAF.
function detectMagic(bytes: Uint8Array | null): string | null {
	if (bytes === null) {
		return null;
	}

	const ascii = (start: number, end: number): string =>
		String.fromCharCode(...bytes.slice(start, end));

	if (bytes.length >= 3 && bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) {
		return "image/jpeg";
	}

	if (
		bytes.length >= 8
		&& bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47
		&& bytes[4] === 0x0D && bytes[5] === 0x0A && bytes[6] === 0x1A && bytes[7] === 0x0A
	) {
		return "image/png";
	}

	if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") {
		return "image/webp";
	}

	if (
		bytes.length >= 4
		&& (
			(bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2A && bytes[3] === 0x00)
			|| (bytes[0] === 0x4D && bytes[1] === 0x4D && bytes[2] === 0x00 && bytes[3] === 0x2A)
		)
	) {
		return "image/tiff";
	}

	if (bytes.length >= 8 && ascii(0, 8) === "FUJIFILM") {
		return "image/raf";
	}

	return null;
}

function slugifiedFilename(filename: string): string | null {
	const extension = extname(filename).toLowerCase();

	if (extension === "" || !ALLOWED_EXTENSIONS.has(extension)) {
		return null;
	}

	const base = basename(filename, extname(filename))
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 40);

	return `${base === "" ? "photo" : base}${extension}`;
}

function parseIsoDate(value: string | null): Date | null {
	if (value === null) {
		return null;
	}

	const parsed = new Date(value);

	if (Number.isNaN(parsed.getTime())) {
		throw new ValidationError("takenAt is not a valid date");
	}

	return parsed;
}

// Owner decision: PHOTOGRAPHER acts on their own photos only; ADMIN and EDITOR
// are archive-wide. Applied to reads, writes and registration.
function assertPhotoAccess(actor: AuthenticatedUser, photo: Pick<Photo, "photographerId">): void {
	if (actor.role === "PHOTOGRAPHER" && photo.photographerId !== actor.id) {
		throw new AuthorizationError("Insufficient permissions");
	}
}

async function getPhotoOrThrow(id: string): Promise<Photo> {
	const photo = await findPhotoById(id);

	if (photo === null) {
		throw new NotFoundError("Photo not found");
	}

	return photo;
}

async function verifyObject(key: string, expectedSha256?: string): Promise<void> {
	const head = await storage.headObject(key);

	if (head === null) {
		throw new ValidationError("Uploaded object not found");
	}

	if (head.size > config.env.UPLOAD_MAX_BYTES) {
		throw new ValidationError(`File exceeds the ${config.env.UPLOAD_MAX_BYTES} byte limit`);
	}

	const magic = await storage.getFirstBytes(key, 16);

	if (detectMagic(magic) === null) {
		throw new ValidationError("Unsupported image format");
	}

	if (expectedSha256 !== undefined) {
		const actual = await storage.getObjectSha256(key);

		if (actual === null) {
			throw new ValidationError("Could not verify file integrity");
		}

		if (actual.toLowerCase() !== expectedSha256.toLowerCase()) {
			throw new ValidationError("File integrity check failed");
		}
	}
}

export interface PhotoFilters {
	status?: ListPhotosQuery["status"];
	visibility?: ListPhotosQuery["visibility"];
	availability?: ListPhotosQuery["availability"];
	uploadStatus?: ListPhotosQuery["uploadStatus"];
	photographerId?: string;
	q?: string;
}

export async function listAllPhotos(
	actor: AuthenticatedUser,
	page: number,
	pageSize: number,
	filters: PhotoFilters = {},
): Promise<PhotoList> {
	const scopePhotographerId = actor.role === "PHOTOGRAPHER" ? actor.id : undefined;

	if (scopePhotographerId !== undefined
		&& filters.photographerId !== undefined
		&& filters.photographerId !== scopePhotographerId) {
		throw new AuthorizationError("Insufficient permissions");
	}

	const where: ListPhotosWhere = {
		// Design (a): intent rows are PENDING and hidden unless explicitly asked for.
		uploadStatus: filters.uploadStatus ?? { not: "PENDING" },
		...(scopePhotographerId === undefined ? {} : { photographerId: scopePhotographerId }),
		...(filters.status === undefined ? {} : { status: filters.status }),
		...(filters.visibility === undefined ? {} : { visibility: filters.visibility }),
		...(filters.availability === undefined ? {} : { availability: filters.availability }),
		...(filters.photographerId === undefined || scopePhotographerId !== undefined
			? {}
			: { photographerId: filters.photographerId }),
		...(filters.q === undefined
			? {}
			: {
				OR: [
					{ title: { contains: filters.q, mode: "insensitive" } },
					{ description: { contains: filters.q, mode: "insensitive" } },
					{ location: { contains: filters.q, mode: "insensitive" } },
				],
			}),
	};

	const [items, total] = await Promise.all([
		listPhotos(where, (page - 1) * pageSize, pageSize),
		countPhotos(where),
	]);

	return { items: await Promise.all(items.map(toPhotoDTO)), page, pageSize, total };
}

export async function getPhoto(actor: AuthenticatedUser, id: string): Promise<PhotoDTO> {
	const photo = await getPhotoOrThrow(id);
	assertPhotoAccess(actor, photo);

	return toPhotoDTO(photo);
}

export async function createUploadIntent(actor: AuthenticatedUser, input: CreateUploadBody): Promise<UploadIntent> {
	const contentType = input.contentType.split(";")[0].trim().toLowerCase();

	if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
		throw new ValidationError("Unsupported content type");
	}

	let filename: string | null = null;

	if (input.filename !== undefined) {
		filename = slugifiedFilename(input.filename);

		if (filename === null) {
			throw new ValidationError("Unsupported file type");
		}
	}

	const key = `originals/${randomUUID()}${filename === null ? "" : `-${filename}`}`;
	const uploadUrl = await storage.presignPut(key, { contentType: input.contentType });

	if (uploadUrl === null) {
		throw new ServiceUnavailableError("Storage is not configured");
	}

	await createPhoto({
		originalKey: key,
		uploadStatus: "PENDING",
		photographerId: actor.role === "PHOTOGRAPHER" ? actor.id : null,
	});

	return { key, uploadUrl };
}

export async function registerPhoto(actor: AuthenticatedUser, input: CreatePhotoBody): Promise<PhotoDTO> {
	const pending = await findPhotoByOriginalKey(input.originalKey);

	if (pending !== null) {
		assertPhotoAccess(actor, pending);

		if (pending.uploadStatus === "READY") {
			throw new ConflictError("Photo already registered");
		}
	}
	else if (actor.role === "PHOTOGRAPHER" && input.photographerId != null && input.photographerId !== actor.id) {
		throw new AuthorizationError("Insufficient permissions");
	}

	try {
		await verifyObject(input.originalKey, input.sha256);
	}
	catch (error) {
		if (pending !== null && pending.uploadStatus === "PENDING") {
			await updatePhoto(pending.id, { uploadStatus: "FAILED" });
		}

		throw error;
	}

	const photographerId = input.photographerId === undefined
		? (pending === null
			? (actor.role === "PHOTOGRAPHER" ? actor.id : null)
			: pending.photographerId)
		: input.photographerId;

	const meta: UpdatePhotoInput = {
		title: input.title ?? null,
		description: input.description ?? null,
		width: input.width ?? null,
		height: input.height ?? null,
		takenAt: input.takenAt === undefined ? null : parseIsoDate(input.takenAt),
		location: input.location ?? null,
		...(input.visibility === undefined ? {} : { visibility: input.visibility }),
		...(input.availability === undefined ? {} : { availability: input.availability }),
		priceCents: input.priceCents ?? null,
		currency: input.currency ?? "EUR",
		photographerId,
		uploadStatus: "READY",
	};

	const photo = pending === null
		? await createPhoto({ originalKey: input.originalKey, ...meta, uploadStatus: "READY" })
		: await updatePhoto(pending.id, meta);

	await logAudit({
		actorId: actor.id,
		action: "photos.create",
		resourceType: "photo",
		resourceId: photo.id,
		result: "SUCCESS",
		metadata: {
			originalKey: photo.originalKey,
			uploadStatus: photo.uploadStatus,
			visibility: photo.visibility,
			...(photographerId === null ? {} : { photographerId }),
		},
	});

	return toPhotoDTO(photo);
}

export async function updatePhotoRecord(
	actor: AuthenticatedUser,
	id: string,
	patch: UpdatePhotoBody,
): Promise<PhotoDTO> {
	const photo = await getPhotoOrThrow(id);
	assertPhotoAccess(actor, photo);

	if (patch.photographerId !== undefined && patch.photographerId !== null
		&& actor.role === "PHOTOGRAPHER" && patch.photographerId !== actor.id) {
		throw new AuthorizationError("Insufficient permissions");
	}

	const next: UpdatePhotoInput = {
		...(patch.title === undefined ? {} : { title: patch.title === null ? null : patch.title.trim() }),
		...(patch.description === undefined ? {} : { description: patch.description === null ? null : patch.description.trim() }),
		...(patch.takenAt === undefined ? {} : { takenAt: parseIsoDate(patch.takenAt) }),
		...(patch.location === undefined ? {} : { location: patch.location === null ? null : patch.location.trim() }),
		...(patch.visibility === undefined ? {} : { visibility: patch.visibility }),
		...(patch.availability === undefined ? {} : { availability: patch.availability }),
		...(patch.priceCents === undefined ? {} : { priceCents: patch.priceCents }),
		...(patch.currency === undefined ? {} : { currency: patch.currency }),
		...(patch.photographerId === undefined ? {} : { photographerId: patch.photographerId }),
	};

	const updated = await updatePhoto(id, next);

	await logAudit({
		actorId: actor.id,
		action: "photos.update",
		resourceType: "photo",
		resourceId: id,
		result: "SUCCESS",
		metadata: {
			...(patch.visibility === undefined ? {} : { visibility: patch.visibility }),
			...(patch.availability === undefined ? {} : { availability: patch.availability }),
			...(patch.photographerId === undefined ? {} : { photographerId: patch.photographerId }),
		},
	});

	return toPhotoDTO(updated);
}

export async function publishPhoto(actor: AuthenticatedUser, id: string): Promise<PhotoDTO> {
	const photo = await getPhotoOrThrow(id);
	assertPhotoAccess(actor, photo);

	if (photo.uploadStatus !== "READY") {
		throw new ValidationError("Photo upload is not complete");
	}

	const from = photo.status;
	const to = from === "DRAFT" ? "APPROVED" : from === "APPROVED" ? "PUBLISHED" : null;

	if (to === null) {
		throw new ValidationError("Photo is already published");
	}

	const updated = await updatePhoto(id, { status: to });

	await logAudit({
		actorId: actor.id,
		action: "photos.publish",
		resourceType: "photo",
		resourceId: id,
		result: "SUCCESS",
		metadata: { from, to },
	});

	return toPhotoDTO(updated);
}

export async function unpublishPhoto(actor: AuthenticatedUser, id: string): Promise<PhotoDTO> {
	const photo = await getPhotoOrThrow(id);
	assertPhotoAccess(actor, photo);

	if (photo.status !== "PUBLISHED") {
		throw new ValidationError("Photo is not published");
	}

	const updated = await updatePhoto(id, { status: "DRAFT" });

	await logAudit({
		actorId: actor.id,
		action: "photos.unpublish",
		resourceType: "photo",
		resourceId: id,
		result: "SUCCESS",
		metadata: { from: "PUBLISHED", to: "DRAFT" },
	});

	return toPhotoDTO(updated);
}

export async function deletePhotoRecord(actor: AuthenticatedUser, id: string): Promise<void> {
	const photo = await getPhotoOrThrow(id);
	assertPhotoAccess(actor, photo);

	const counts = await referenceCounts(id);

	if (counts.album + counts.gallery + counts.purchase > 0) {
		throw new ConflictError("Photo is referenced by albums, galleries or purchases");
	}

	await deletePhoto(id);

	await logAudit({
		actorId: actor.id,
		action: "photos.delete",
		resourceType: "photo",
		resourceId: id,
		result: "SUCCESS",
		metadata: null,
	});
}
