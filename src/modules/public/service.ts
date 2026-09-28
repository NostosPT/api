import { config } from "../../config/index.js";
import { NotFoundError, ValidationError } from "../../errors/appError.js";
import { verifyPassword } from "../../auth/password.js";
import { verifyCapabilityToken } from "../../lib/capability.js";
import {
	findPhotoByNumberPublic,
	findPhotographerName,
	findPublicCategories,
	findPublicTags,
	listPublicPhotos as repoListPublicPhotos,
	countPublicPhotos as repoCountPublicPhotos,
	findPublishedGalleryIds,
	findMembershipPhotoIds,
	findPhotoIdsByCategorySlug,
	findPhotoIdsByTagSlug,
	findPublishedGalleries,
	findGalleryBySlugPublic,
	getPublishedGalleryEntries,
	findPhotosByIdsPublic,
} from "./repository.js";

import {
	findPublishedAlbumBySlug,
	getAlbumPhotosWithVisibility,
	findPhotosByIds,
} from "../albums/repository.js";
import {
	toPublicGalleryDTO,
	type PublicGalleryDetailDTO,
	type PublicPhotoDetailDTO,
	type PublicPhotoPage,
	type PublicGalleryPage,
} from "./dto.js";
import type { ListPublicPhotosQuery } from "./schemas.js";

function parseDate(value: string | undefined): Date | null {
	if (!value) {
		return null;
	}

	const parsed = new Date(value);

	if (Number.isNaN(parsed.getTime())) {
		throw new ValidationError(`${value} is not a valid date`);
	}

	return parsed;
}

export async function listPublicGalleries(
	page: number,
	pageSize: number,
): Promise<PublicGalleryPage> {
	const galleries = await findPublishedGalleries();

	// Position nulls-last is not reliably handled by the mock; sort in JS for
	// parity (collections are few — negligible cost).
	galleries.sort((a, b) => {
		const pa = a.position ?? Infinity;
		const pb = b.position ?? Infinity;

		if (pa !== pb) {
			return pa - pb;
		}

		return a.createdAt.getTime() - b.createdAt.getTime();
	});

	const start = (page - 1) * pageSize;
	const items = galleries.slice(start, start + pageSize).map(toPublicGalleryDTO);

	return { items, page, pageSize, total: galleries.length };
}

export async function getPublicGallery(slug: string): Promise<PublicGalleryDetailDTO> {
	const gallery = await findGalleryBySlugPublic(slug);

	if (gallery === null) {
		throw new NotFoundError("Gallery not found");
	}

	const entries = await getPublishedGalleryEntries(gallery.id);

	if (entries.length === 0) {
		return { ...toPublicGalleryDTO(gallery), photos: [] };
	}

	const photoIds = entries.map((e) => e.photoId);
	const photos = await findPhotosByIdsPublic(photoIds);
	const photoMap = new Map(photos.map((p) => [p.id, p]));

	const publicPhotos = entries
		.map((entry) => {
			const photo = photoMap.get(entry.photoId);

			if (!photo) {
				return null;
			}

			return {
				number: photo.number,
				title: photo.title,
				width: photo.width,
				height: photo.height,
				isFeatured: entry.isFeatured,
				availability: photo.availability,
				priceCents: photo.priceCents,
				currency: photo.currency,
				takenAt: photo.takenAt?.toISOString() ?? null,
			};
		})
		.filter((p): p is NonNullable<typeof p> => p !== null);

	return { ...toPublicGalleryDTO(gallery), photos: publicPhotos };
}

function buildPhotoWhere(query: ListPublicPhotosQuery): Omit<Parameters<typeof repoListPublicPhotos>[1], "id"> {
	const where: Record<string, unknown> = {};

	if (query.takenFrom !== undefined || query.takenTo !== undefined) {
		where.takenAt = {
			...(query.takenFrom !== undefined ? { gte: parseDate(query.takenFrom) } : {}),
			...(query.takenTo !== undefined ? { lte: parseDate(query.takenTo) } : {}),
		};
	}

	if (query.q !== undefined) {
		const q = query.q.trim();

		if (/^\d+$/.test(q)) {
			where.OR = [
				{ title: { contains: q, mode: "insensitive" } },
				{ description: { contains: q, mode: "insensitive" } },
				{ number: parseInt(q, 10) },
			];
		} else {
			where.OR = [
				{ title: { contains: q, mode: "insensitive" } },
				{ description: { contains: q, mode: "insensitive" } },
			];
		}
	}

	return where;
}

export async function listPublicPhotos(query: ListPublicPhotosQuery): Promise<PublicPhotoPage> {
	const page = query.page ?? 1;
	const pageSize = query.pageSize ?? 20;

	// 1. Candidate photos = those in any published gallery.
	const publishedGalleryIds = await findPublishedGalleryIds();
	const membership = await findMembershipPhotoIds(publishedGalleryIds);

	let candidateSet = new Set(membership.map((m) => m.photoId));

	// 2. Narrow by gallery slug (if provided).
	if (query.gallery !== undefined) {
		const gallery = await findGalleryBySlugPublic(query.gallery);

		if (gallery === null) {
			candidateSet = new Set();
		} else {
			const entries = await getPublishedGalleryEntries(gallery.id);
			candidateSet = new Set(entries.map((e) => e.photoId));
		}
	}

	// 3. Narrow by category/tag (intersect).
	if (query.category !== undefined) {
		const catIds = await findPhotoIdsByCategorySlug(query.category);
		candidateSet = new Set(catIds.filter((id) => candidateSet.has(id)));
	}

	if (query.tag !== undefined) {
		const tagIds = await findPhotoIdsByTagSlug(query.tag);
		candidateSet = new Set(tagIds.filter((id) => candidateSet.has(id)));
	}

	if (candidateSet.size === 0) {
		return { items: [], page, pageSize, total: 0 };
	}

	// 4. Featured filter: keep only photos with at least one featured pin.
	if (query.sort === "featured") {
		const featuredIds = new Set(membership.filter((m) => m.isFeatured).map((m) => m.photoId));
		candidateSet = new Set([...candidateSet].filter((id) => featuredIds.has(id)));

		if (candidateSet.size === 0) {
			return { items: [], page, pageSize, total: 0 };
		}
	}

	const where = buildPhotoWhere(query);

	// 5. Order.
	const orderBy: { createdAt: "asc" | "desc" } = query.sort === "oldest" ? { createdAt: "asc" } : { createdAt: "desc" };

	// 6. Paginate + total (repository does candidate filtering in JS for mock compatibility).
	const [photos, total] = await Promise.all([
		repoListPublicPhotos(candidateSet, where, (page - 1) * pageSize, pageSize, orderBy),
		repoCountPublicPhotos(candidateSet, where),
	]);

	return {
		items: photos.map((p) => ({
			number: p.number,
			title: p.title,
			width: p.width,
			height: p.height,
			availability: p.availability,
			priceCents: p.priceCents,
			currency: p.currency,
			takenAt: p.takenAt?.toISOString() ?? null,
		})),
		page,
		pageSize,
		total,
	};
}

export async function getPublicPhoto(number: number): Promise<PublicPhotoDetailDTO> {
	const photo = await findPhotoByNumberPublic(number);

	if (photo === null) {
		throw new NotFoundError("Photo not found");
	}

	const [credit, categories, tags] = await Promise.all([
		photo.photographerId ? findPhotographerName(photo.photographerId) : Promise.resolve(null),
		findPublicCategories(photo.id),
		findPublicTags(photo.id),
	]);

	const copyright = config.env.SITE_COPYRIGHT ?? null;

	return {
		number: photo.number,
		title: photo.title,
		description: photo.description,
		width: photo.width,
		height: photo.height,
		takenAt: photo.takenAt?.toISOString() ?? null,
		location: photo.location,
		availability: photo.availability,
		priceCents: photo.priceCents,
		currency: photo.currency,
		credit,
		copyright,
		categories: categories.map((c) => ({ slug: c.slug, name: c.name })),
		tags: tags.map((t) => ({ slug: t.slug, name: t.name })),
		createdAt: photo.createdAt.toISOString(),
	};
}

export interface PublicAlbumPhoto {
	id: string;
	number: number;
	title: string | null;
	description: string | null;
	width: number | null;
	height: number | null;
	visibility: string;
	availability: string;
	priceCents: number | null;
	currency: string;
	isPreview: boolean;
	isLocked: boolean;
}

export interface PublicAlbumDetail {
	id: string;
	slug: string;
	title: string;
	description: string | null;
	type: string;
	expiresAt: string | null;
	photos: PublicAlbumPhoto[];
	requiresAccessCode: boolean;
}

function isAlbumExpired(album: { expiresAt: Date | null }): boolean {
	if (album.expiresAt === null) {
		return false;
	}
	return album.expiresAt < new Date();
}

function determinePhotoAccess(
	albumType: string,
	isPreview: boolean,
	hasPurchase: boolean,
): { isLocked: boolean } {
	if (albumType === "FREE") {
		return { isLocked: false };
	}

	if (albumType === "WATERMARK") {
		return { isLocked: false };
	}

	if (albumType === "PAID") {
		if (isPreview) {
			return { isLocked: false };
		}
		if (hasPurchase) {
			return { isLocked: false };
		}
		return { isLocked: true };
	}

	return { isLocked: true };
}

export async function getPublicAlbum(
	slug: string,
	token: string | undefined,
	exp: string | undefined,
	accessCode: string | undefined,
): Promise<PublicAlbumDetail> {
	const album = await findPublishedAlbumBySlug(slug);

	if (album === null) {
		throw new NotFoundError("Album not found");
	}

	if (isAlbumExpired(album)) {
		throw new NotFoundError("Album not found");
	}

	const secret = config.env.COOKIE_SECRET;
	const capability = token !== undefined && exp !== undefined
		? verifyCapabilityToken(secret, album.id, album.secretVersion, token, parseInt(exp, 10))
		: null;

	if (capability === null) {
		throw new NotFoundError("Album not found");
	}

	const requiresAccessCode = album.type === "WATERMARK" || album.type === "PAID";

	if (requiresAccessCode) {
		if (album.accessCodeHash === null) {
			throw new ValidationError("Album is not properly configured");
		}

		if (accessCode === undefined) {
			throw new ValidationError("Access code required");
		}

		const codeValid = await verifyPassword(album.accessCodeHash, accessCode);

		if (!codeValid) {
			throw new ValidationError("Invalid access code");
		}
	}

	const albumPhotos = await getAlbumPhotosWithVisibility(album.id);

	if (albumPhotos.length === 0) {
		return {
			id: album.id,
			slug: album.slug,
			title: album.title,
			description: album.description,
			type: album.type,
			expiresAt: album.expiresAt?.toISOString() ?? null,
			photos: [],
			requiresAccessCode,
		};
	}

	// TODO: Implement purchase check when purchase entitlement is available
	const hasPurchase = false;

	const photoIds = albumPhotos.map((ap) => ap.photoId);
	const photos = await findPhotosByIds(photoIds);
	const photoMap = new Map(photos.map((p) => [p.id, p]));

	const publicPhotos: Array<{
		id: string;
		number: number;
		title: string | null;
		description: string | null;
		width: number | null;
		height: number | null;
		visibility: string;
		availability: string;
		priceCents: number | null;
		currency: string;
		isPreview: boolean;
		isLocked: boolean;
	}> = albumPhotos
		.map((ap) => {
			const photo = photoMap.get(ap.photoId);
			if (!photo) return null;

			const access = determinePhotoAccess(album.type, ap.isPreview, hasPurchase);

			return {
				id: photo.id,
				number: photo.number,
				title: photo.title,
				description: photo.description,
				width: photo.width,
				height: photo.height,
				visibility: photo.visibility,
				availability: photo.availability,
				priceCents: photo.priceCents,
				currency: photo.currency,
				isPreview: ap.isPreview,
				isLocked: access.isLocked,
			};
		})
		.filter((p): p is NonNullable<typeof p> => p !== null);

	return {
		id: album.id,
		slug: album.slug,
		title: album.title,
		description: album.description,
		type: album.type,
		expiresAt: album.expiresAt?.toISOString() ?? null,
		photos: publicPhotos,
		requiresAccessCode,
	};
}