import type { Category, Photo, Tag } from "@prisma/client";

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

// Renditions (displayKey/thumbnailKey) are Phase 2: public DTOs deliberately
// carry no image URLs — originals are private and URLs are ephemeral.
export function toPublicPhotoSummary(photo: Photo, isFeatured?: boolean): PublicPhotoSummary {
	const summary: PublicPhotoSummary = {
		number: photo.number,
		title: photo.title,
		width: photo.width,
		height: photo.height,
		availability: photo.availability,
		priceCents: photo.priceCents,
		currency: photo.currency,
		takenAt: photo.takenAt?.toISOString() ?? null,
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
