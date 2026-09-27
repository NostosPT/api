import { Type } from "typebox";
import type { Static } from "typebox";
import {
	IdParams,
	OptionalOrNull,
	PaginationQuery,
	SlugString,
	TagStatusEnum,
	TagVisibilityEnum,
} from "../../validation/common.js";

const StrictObject = { additionalProperties: false } as const;

export const CreateTagBody = Type.Object(
	{
		name: Type.String({ minLength: 1, maxLength: 120 }),
		slug: SlugString,
		description: Type.Optional(Type.String({ maxLength: 500 })),
		status: Type.Optional(TagStatusEnum),
		visibility: Type.Optional(TagVisibilityEnum),
	},
	StrictObject,
);

export type CreateTagBody = Static<typeof CreateTagBody>;

export const UpdateTagBody = Type.Object(
	{
		name: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
		description: OptionalOrNull(Type.String({ maxLength: 500 })),
		status: Type.Optional(TagStatusEnum),
		visibility: Type.Optional(TagVisibilityEnum),
	},
	StrictObject,
);

export type UpdateTagBody = Static<typeof UpdateTagBody>;

export const ListTagsQuery = Type.Object(
	{
		...PaginationQuery.properties,
		status: Type.Optional(TagStatusEnum),
		visibility: Type.Optional(TagVisibilityEnum),
		q: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
	},
	StrictObject,
);

export type ListTagsQuery = Static<typeof ListTagsQuery>;

export { IdParams, PaginationQuery };
