import type { Gallery, GalleryStatus } from "@prisma/client";

export interface GalleryEntryDTO {
	photoId: string;
	position: number;
	isFeatured: boolean;
}

export interface GalleryDTO {
	id: string;
	slug: string;
	title: string;
	description: string | null;
	status: GalleryStatus;
	position: number | null;
	createdAt: string;
	updatedAt: string;
}

export interface GalleryDetailDTO extends GalleryDTO {
	entries: GalleryEntryDTO[];
}

export function toGalleryDTO(gallery: Gallery): GalleryDTO {
	return {
		id: gallery.id,
		slug: gallery.slug,
		title: gallery.title,
		description: gallery.description,
		status: gallery.status,
		position: gallery.position,
		createdAt: gallery.createdAt.toISOString(),
		updatedAt: gallery.updatedAt.toISOString(),
	};
}

export interface GalleryList {
	items: GalleryDTO[];
	page: number;
	pageSize: number;
	total: number;
}
