import { NotFoundError } from "../../errors/appError.js";
import { findAlbumById } from "../albums/repository.js";
import { toFavoriteDTO, type FavoriteList, type FavoritePhotoSummary } from "./dto.js";
import { countFavorites, findFavoritePhotos, listFavorites } from "./repository.js";

export interface FavoriteFilters {
	clientId?: string;
}

// Staff read surface (REQUIREMENTS §5): delivery roles view per-album
// favorite lists and counts for purchase assistance. Client-side writes and
// public reads belong to the public album endpoints (item 6).
export async function listAlbumFavorites(
	albumId: string,
	page: number,
	pageSize: number,
	filters: FavoriteFilters = {},
): Promise<FavoriteList> {
	const album = await findAlbumById(albumId);

	if (album === null) {
		throw new NotFoundError("Album not found");
	}

	const where = {
		albumId,
		...(filters.clientId === undefined ? {} : { clientId: filters.clientId }),
	};

	const [items, total] = await Promise.all([
		listFavorites(where, (page - 1) * pageSize, pageSize),
		countFavorites(where),
	]);

	const photos = await findFavoritePhotos([...new Set(items.map((favorite) => favorite.photoId))]);

	return {
		items: items.map((favorite) => {
			const photo = photos[favorite.photoId] as FavoritePhotoSummary | undefined;

			return toFavoriteDTO(favorite, photo ?? null);
		}),
		page,
		pageSize,
		total,
	};
}
