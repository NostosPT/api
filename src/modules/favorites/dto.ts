import type { Favorite } from "@prisma/client";

export interface FavoritePhotoSummary {
	id: string;
	number: number;
	title: string | null;
	availability: string;
	priceCents: number | null;
	currency: string;
}

export interface FavoriteDTO {
	id: string;
	clientId: string;
	albumId: string;
	photoId: string;
	createdAt: string;
	// Purchase assistance: staff see which photo was favorited without a
	// second request. The composite FK guarantees the photo still exists.
	photo: FavoritePhotoSummary | null;
}

export function toFavoriteDTO(favorite: Favorite, photo: FavoritePhotoSummary | null): FavoriteDTO {
	return {
		id: favorite.id,
		clientId: favorite.clientId,
		albumId: favorite.albumId,
		photoId: favorite.photoId,
		createdAt: favorite.createdAt.toISOString(),
		photo,
	};
}

export interface FavoriteList {
	items: FavoriteDTO[];
	page: number;
	pageSize: number;
	total: number;
}
