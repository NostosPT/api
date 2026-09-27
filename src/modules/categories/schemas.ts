import { Type } from "typebox";
import type { Static } from "typebox";
import {
	CategoryStatusEnum,
	IdParams,
	OptionalOrNull,
	PaginationQuery,
	SlugString,
} from "../../validation/common.js";

const StrictObject = { additionalProperties: false } as const;

export const CreateCategoryBody = Type.Object(
	{
		name: Type.String({ minLength: 1, maxLength: 120 }),
		slug: SlugString,
		description: Type.Optional(Type.String({ maxLength: 500 })),
		status: Type.Optional(CategoryStatusEnum),
	},
	StrictObject,
);

export type CreateCategoryBody = Static<typeof CreateCategoryBody>;

export const UpdateCategoryBody = Type.Object(
	{
		name: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
		description: OptionalOrNull(Type.String({ maxLength: 500 })),
		status: Type.Optional(CategoryStatusEnum),
	},
	StrictObject,
);

export type UpdateCategoryBody = Static<typeof UpdateCategoryBody>;

export const ListCategoriesQuery = Type.Object(
	{
		...PaginationQuery.properties,
		status: Type.Optional(CategoryStatusEnum),
		q: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
	},
	StrictObject,
);

export type ListCategoriesQuery = Static<typeof ListCategoriesQuery>;

export { IdParams, PaginationQuery };
