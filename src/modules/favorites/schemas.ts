import { Type } from "typebox";
import type { Static } from "typebox";
import { PaginationQuery, UUID_PATTERN } from "../../validation/common.js";

const StrictObject = { additionalProperties: false } as const;

export const ListFavoritesQuery = Type.Object(
	{
		...PaginationQuery.properties,
		clientId: Type.Optional(Type.String({ pattern: UUID_PATTERN })),
	},
	StrictObject,
);

export type ListFavoritesQuery = Static<typeof ListFavoritesQuery>;
