import type { Album, AlbumStatus, AlbumType } from "@prisma/client";

export interface AlbumDTO {
	id: string;
	clientId: string;
	slug: string;
	title: string;
	description: string | null;
	type: AlbumType;
	status: AlbumStatus;
	// Never the hash itself - only whether a code is configured.
	hasAccessCode: boolean;
	secretVersion: number;
	priceCents: number | null;
	packPriceCents: number | null;
	packSize: number | null;
	currency: string;
	coverPhotoId: string | null;
	expiresAt: string | null;
	publishedAt: string | null;
	views: number;
	lastViewedAt: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface AlbumDetailDTO extends AlbumDTO {
	photoIds: string[];
}

export function toAlbumDTO(album: Album): AlbumDTO {
	return {
		id: album.id,
		clientId: album.clientId,
		slug: album.slug,
		title: album.title,
		description: album.description,
		type: album.type,
		status: album.status,
		hasAccessCode: album.accessCodeHash !== null,
		secretVersion: album.secretVersion,
		priceCents: album.priceCents,
		packPriceCents: album.packPriceCents,
		packSize: album.packSize,
		currency: album.currency,
		coverPhotoId: album.coverPhotoId,
		expiresAt: album.expiresAt?.toISOString() ?? null,
		publishedAt: album.publishedAt?.toISOString() ?? null,
		views: album.views,
		lastViewedAt: album.lastViewedAt?.toISOString() ?? null,
		createdAt: album.createdAt.toISOString(),
		updatedAt: album.updatedAt.toISOString(),
	};
}

export interface AlbumList {
	items: AlbumDTO[];
	page: number;
	pageSize: number;
	total: number;
}
