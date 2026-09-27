import { Type } from "typebox";
import type { Static } from "typebox";
import {
	AlbumStatusEnum,
	AlbumTypeEnum,
	IdParams,
	IsoDateTimeString,
	OptionalOrNull,
	PaginationQuery,
	SlugString,
	UUID_PATTERN,
} from "../../validation/common.js";

const StrictObject = { additionalProperties: false } as const;

const UuidString = Type.String({ pattern: UUID_PATTERN });

export const CreateAlbumBody = Type.Object(
	{
		clientId: UuidString,
		title: Type.String({ minLength: 1, maxLength: 200 }),
		description: Type.Optional(Type.String({ maxLength: 2000 })),
		type: AlbumTypeEnum,
		// Server generates an unguessable suffix when omitted; the slug is
		// immutable afterwards (services precedent).
		slug: Type.Optional(SlugString),
		priceCents: Type.Optional(Type.Integer({ minimum: 0 })),
		packPriceCents: Type.Optional(Type.Integer({ minimum: 0 })),
		packSize: Type.Optional(Type.Integer({ minimum: 1 })),
		currency: Type.Optional(Type.String({ pattern: "^[A-Z]{3}$" })),
		coverPhotoId: Type.Optional(Type.Union([UuidString, Type.Null()])),
		expiresAt: Type.Optional(Type.Union([IsoDateTimeString, Type.Null()])),
	},
	StrictObject,
);

export type CreateAlbumBody = Static<typeof CreateAlbumBody>;

export const UpdateAlbumBody = Type.Object(
	{
		title: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
		description: OptionalOrNull(Type.String({ maxLength: 2000 })),
		type: Type.Optional(AlbumTypeEnum),
		priceCents: OptionalOrNull(Type.Integer({ minimum: 0 })),
		packPriceCents: OptionalOrNull(Type.Integer({ minimum: 0 })),
		packSize: OptionalOrNull(Type.Integer({ minimum: 1 })),
		currency: Type.Optional(Type.String({ pattern: "^[A-Z]{3}$" })),
		coverPhotoId: OptionalOrNull(UuidString),
		expiresAt: OptionalOrNull(IsoDateTimeString),
	},
	StrictObject,
);

export type UpdateAlbumBody = Static<typeof UpdateAlbumBody>;

export const ListAlbumsQuery = Type.Object(
	{
		...PaginationQuery.properties,
		clientId: Type.Optional(UuidString),
		status: Type.Optional(AlbumStatusEnum),
		type: Type.Optional(AlbumTypeEnum),
		q: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
	},
	StrictObject,
);

export type ListAlbumsQuery = Static<typeof ListAlbumsQuery>;

export const SetAccessCodeBody = Type.Object(
	{ code: Type.String({ pattern: "^[A-Za-z0-9]{4,32}$" }) },
	StrictObject,
);

export type SetAccessCodeBody = Static<typeof SetAccessCodeBody>;

export const SetAlbumPhotosBody = Type.Object(
	{ photoIds: Type.Array(UuidString, { maxItems: 1000 }) },
	StrictObject,
);

export type SetAlbumPhotosBody = Static<typeof SetAlbumPhotosBody>;

export const UpdateAlbumPhotoBody = Type.Object(
	{ isPreview: Type.Boolean() },
	StrictObject,
);

export type UpdateAlbumPhotoBody = Static<typeof UpdateAlbumPhotoBody>;

export const AlbumPhotoParams = Type.Object(
	{ id: UuidString, photoId: UuidString },
	StrictObject,
);

export const AlbumTagParams = Type.Object(
	{ id: UuidString, tagId: UuidString },
	StrictObject,
);

export { IdParams };

export type AlbumTagParams = Static<typeof AlbumTagParams>;
