import { Type } from "typebox";
import type { Static } from "typebox";
import {
	GalleryStatusEnum,
	IdParams,
	OptionalOrNull,
	PaginationQuery,
	SlugString,
	UUID_PATTERN,
} from "../../validation/common.js";

const StrictObject = { additionalProperties: false } as const;

const UuidString = Type.String({ pattern: UUID_PATTERN });

export const CreateGalleryBody = Type.Object(
	{
		title: Type.String({ minLength: 1, maxLength: 200 }),
		description: Type.Optional(Type.String({ maxLength: 2000 })),
		// Server generates a suffix when omitted; the slug is immutable
		// afterwards (services/albums precedent).
		slug: Type.Optional(SlugString),
		position: Type.Optional(Type.Union([Type.Integer({ minimum: 0 }), Type.Null()])),
	},
	StrictObject,
);

export type CreateGalleryBody = Static<typeof CreateGalleryBody>;

export const UpdateGalleryBody = Type.Object(
	{
		title: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
		description: OptionalOrNull(Type.String({ maxLength: 2000 })),
		position: OptionalOrNull(Type.Integer({ minimum: 0 })),
	},
	StrictObject,
);

export type UpdateGalleryBody = Static<typeof UpdateGalleryBody>;

export const ListGalleriesQuery = Type.Object(
	{
		...PaginationQuery.properties,
		status: Type.Optional(GalleryStatusEnum),
		q: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
	},
	StrictObject,
);

export type ListGalleriesQuery = Static<typeof ListGalleriesQuery>;

export const SetGalleryPhotosBody = Type.Object(
	{ photoIds: Type.Array(UuidString, { maxItems: 1000 }) },
	StrictObject,
);

export type SetGalleryPhotosBody = Static<typeof SetGalleryPhotosBody>;

export const UpdateGalleryPhotoBody = Type.Object(
	{ isFeatured: Type.Boolean() },
	StrictObject,
);

export type UpdateGalleryPhotoBody = Static<typeof UpdateGalleryPhotoBody>;

export const GalleryPhotoParams = Type.Object(
	{ id: UuidString, photoId: UuidString },
	StrictObject,
);

export { IdParams };
