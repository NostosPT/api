import type { Availability, Photo, PhotoStatus, UploadStatus, Visibility } from "@prisma/client";
import { storage } from "../../storage/index.js";

export interface PhotoUrls {
	display: string | null;
	thumbnail: string | null;
	original: string | null;
}

export interface PhotoDTO {
	id: string;
	number: number;
	title: string | null;
	description: string | null;
	originalKey: string;
	displayKey: string | null;
	thumbnailKey: string | null;
	width: number | null;
	height: number | null;
	takenAt: string | null;
	location: string | null;
	status: PhotoStatus;
	visibility: Visibility;
	availability: Availability;
	priceCents: number | null;
	currency: string;
	photographerId: string | null;
	uploadStatus: UploadStatus;
	createdAt: string;
	updatedAt: string;
	// Ephemeral presigned reads (never stored); null until renditions exist
	// or when storage is not configured.
	urls: PhotoUrls;
}

// Keys only in the domain; URLs are derived at read time (ROADMAP exclusions).
export async function toPhotoDTO(photo: Photo): Promise<PhotoDTO> {
	const [display, thumbnail, original] = await Promise.all([
		photo.displayKey === null ? Promise.resolve(null) : storage.presignGet(photo.displayKey),
		photo.thumbnailKey === null ? Promise.resolve(null) : storage.presignGet(photo.thumbnailKey),
		storage.presignGet(photo.originalKey),
	]);

	return {
		id: photo.id,
		number: photo.number,
		title: photo.title,
		description: photo.description,
		originalKey: photo.originalKey,
		displayKey: photo.displayKey,
		thumbnailKey: photo.thumbnailKey,
		width: photo.width,
		height: photo.height,
		takenAt: photo.takenAt?.toISOString() ?? null,
		location: photo.location,
		status: photo.status,
		visibility: photo.visibility,
		availability: photo.availability,
		priceCents: photo.priceCents,
		currency: photo.currency,
		photographerId: photo.photographerId,
		uploadStatus: photo.uploadStatus,
		createdAt: photo.createdAt.toISOString(),
		updatedAt: photo.updatedAt.toISOString(),
		urls: { display, thumbnail, original },
	};
}

export interface PhotoList {
	items: PhotoDTO[];
	page: number;
	pageSize: number;
	total: number;
}

export interface UploadIntent {
	key: string;
	uploadUrl: string;
}
