import { config } from "../../config/index.js";
import { verifyPassword } from "../../auth/password.js";
import { NotFoundError, ValidationError } from "../../errors/appError.js";
import {
	findPublishedAlbumBySlug,
	getAlbumPhotosWithVisibility,
	findPhotosByIds,
	type Album,
} from "./repository.js";
import { verifyCapabilityToken } from "../../lib/capability.js";

export interface PublicAlbumPhoto {
	id: string;
	number: number;
	title: string | null;
	description: string | null;
	width: number | null;
	height: number | null,
	visibility: string,
	availability: string,
	priceCents: number | null,
	currency: string,
	isPreview: boolean,
	isLocked: boolean,
}

export interface PublicAlbumDetail {
	id: string;
	slug: string;
	title: string;
	description: string | null;
	type: Album["type"];
	expiresAt: string | null;
	photos: PublicAlbumPhoto[];
	requiresAccessCode: boolean;
}

function isAlbumExpired(album: Album): boolean {
	if (album.expiresAt === null) {
		return false;
	}
	return album.expiresAt < new Date();
}

function determinePhotoAccess(
	albumType: Album["type"],
	isPreview: boolean,
	hasPurchase: boolean,
): { isLocked: boolean } {
	// FREE: all photos visible, no lock
	if (albumType === "FREE") {
		return { isLocked: false };
	}

	// WATERMARK: all photos visible (watermarked), no lock
	if (albumType === "WATERMARK") {
		return { isLocked: false };
	}

	// PAID: only preview photos visible without purchase
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
	// Find published album by slug
	const album = await findPublishedAlbumBySlug(slug);

	if (album === null) {
		throw new NotFoundError("Album not found");
	}

	// Check expiration
	if (isAlbumExpired(album)) {
		throw new NotFoundError("Album not found");
	}

	// Verify capability token
	const secret = config.env.COOKIE_SECRET;
	const capability = token !== undefined && exp !== undefined
		? verifyCapabilityToken(secret, album.id, album.secretVersion, token, parseInt(exp, 10))
		: null;

	if (capability === null) {
		throw new NotFoundError("Album not found");
	}

	// Check access code for protected album types
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
			// Rate limiting note: the caller should handle rate limiting
			throw new ValidationError("Invalid access code");
		}
	}

	// Get album photos with visibility
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

	// For PAID albums, we need to check purchase entitlement
	// For now, assume no purchase (Phase 1 - purchase entitlement is derived at read time)
	// The actual purchase check would be done here in a full implementation
	const hasPurchase = false; // TODO: implement purchase check

	// Get photo details
	const photoIds = albumPhotos.map((ap) => ap.photoId);
	const photos = await findPhotosByIds(photoIds);
	const photoMap = new Map(photos.map((p) => [p.id, p]));

	const publicPhotos: PublicAlbumPhoto[] = albumPhotos
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
		.filter((p): p is PublicAlbumPhoto => p !== null);

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

export async function generateAlbumCapability(
	actorId: string,
	albumId: string,
	expSeconds: number = 24 * 60 * 60,
): Promise<{ url: string; token: string; exp: number }> {
	const { createCapabilityUrl } = await import("../../lib/capability.js");
	const { config } = await import("../../config/index.js");

	const album = await (await import("./repository.js")).findAlbumById(albumId);

	if (album === null) {
		throw new NotFoundError("Album not found");
	}

	if (album.status !== "PUBLISHED") {
		throw new ValidationError("Album must be published to generate capability link");
	}

	const baseUrl = config.env.S3_PUBLIC_ENDPOINT ?? "http://localhost:3000"; // Fallback, should be public API URL

	return createCapabilityUrl(baseUrl, album.slug, config.env.COOKIE_SECRET, album.id, album.secretVersion, expSeconds);
}