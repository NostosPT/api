import type { Category, Photo, Tag } from "@prisma/client";
import { storage } from "../../storage/index.js";

export interface PublicGalleryDTO {
	id: string;
	slug: string;
	title: string;
	description: string | null;
	position: number | null;
}

export interface PublicPhotoSummary {
	number: number;
	title: string | null;
	width: number | null;
	height: number | null;
	availability: Photo["availability"];
	priceCents: number | null;
	currency: string;
	takenAt: string | null;
	// Publishable rendition URL (ephemeral presigned read of the display
	// rendition). Null until a display object exists or when storage is not
	// configured — originals are never exposed here.
	imageUrl: string | null;
}

export interface PublicGalleryPhotoSummary extends PublicPhotoSummary {
	isFeatured: boolean;
}

export interface PublicGalleryDetailDTO extends PublicGalleryDTO {
	photos: PublicGalleryPhotoSummary[];
}

export interface PublicTaxonomyRef {
	slug: string;
	name: string;
}

export interface PublicPhotoDetailDTO extends PublicPhotoSummary {
	description: string | null;
	location: string | null;
	// Per-photo credit is the linked photographer's name (REQUIREMENTS §8);
	// copyright is the single global text (SITE_COPYRIGHT).
	credit: string | null;
	copyright: string | null;
	categories: PublicTaxonomyRef[];
	tags: PublicTaxonomyRef[];
	createdAt: string;
}

// Thumbnails stay staff-only for now; the public summary carries at most one
// publishable rendition URL (null until a display object exists or when
// storage is not configured). Originals are never exposed here.
export async function toPublicPhotoSummary(photo: Photo, isFeatured: boolean): Promise<PublicGalleryPhotoSummary>;
export async function toPublicPhotoSummary(photo: Photo, isFeatured?: boolean): Promise<PublicPhotoSummary>;
export async function toPublicPhotoSummary(photo: Photo, isFeatured?: boolean): Promise<PublicPhotoSummary> {
	const imageUrl = photo.displayKey === null ? null : await storage.presignGet(photo.displayKey);

	const summary: PublicPhotoSummary = {
		number: photo.number,
		title: photo.title,
		width: photo.width,
		height: photo.height,
		availability: photo.availability,
		priceCents: photo.priceCents,
		currency: photo.currency,
		takenAt: photo.takenAt?.toISOString() ?? null,
		imageUrl,
	};

	if (isFeatured !== undefined) {
		return { ...summary, isFeatured } as PublicGalleryPhotoSummary;
	}

	return summary;
}

export function toPublicGalleryDTO(gallery: { id: string; slug: string; title: string; description: string | null; position: number | null }): PublicGalleryDTO {
	return {
		id: gallery.id,
		slug: gallery.slug,
		title: gallery.title,
		description: gallery.description,
		position: gallery.position,
	};
}

export function toTaxonomyRefs(rows: (Category | Tag)[]): PublicTaxonomyRef[] {
	return rows.map((row) => ({ slug: row.slug, name: row.name }));
}

export interface PublicPhotoPage {
	items: PublicPhotoSummary[];
	page: number;
	pageSize: number;
	total: number;
}

export interface PublicGalleryPage {
	items: PublicGalleryDTO[];
	page: number;
	pageSize: number;
	total: number;
}
