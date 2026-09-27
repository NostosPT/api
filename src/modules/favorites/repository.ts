import type { Favorite, Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma.js";

export interface ListFavoritesWhere {
	albumId: string;
	clientId?: string;
}

export async function listFavorites(where: ListFavoritesWhere, skip: number, take: number): Promise<Favorite[]> {
	return prisma.favorite.findMany({
		where: where as Prisma.FavoriteWhereInput,
		orderBy: { createdAt: "desc" },
		skip,
		take,
	});
}

export async function countFavorites(where: ListFavoritesWhere): Promise<number> {
	return prisma.favorite.count({ where: where as Prisma.FavoriteWhereInput });
}

export async function findFavoritePhotos(ids: string[]): Promise<Record<string, { id: string; number: number; title: string | null; availability: string; priceCents: number | null; currency: string }>> {
	if (ids.length === 0) {
		return {};
	}

	const rows = await prisma.photo.findMany({
		where: { id: { in: ids } },
		select: { id: true, number: true, title: true, availability: true, priceCents: true, currency: true },
	});

	return Object.fromEntries(rows.map((row) => [row.id, row]));
}
