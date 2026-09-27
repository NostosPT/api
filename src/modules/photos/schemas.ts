import { Type } from "typebox";
import type { Static } from "typebox";
import {
	AvailabilityEnum,
	IdParams,
	IsoDateTimeString,
	OptionalOrNull,
	PaginationQuery,
	PhotoStatusEnum,
	UUID_PATTERN,
	UploadStatusEnum,
	VisibilityEnum,
} from "../../validation/common.js";

const StrictObject = { additionalProperties: false } as const;

export const CreateUploadBody = Type.Object(
	{
		contentType: Type.String({ minLength: 1, maxLength: 100 }),
		filename: Type.Optional(Type.String({ maxLength: 255 })),
	},
	StrictObject,
);

export type CreateUploadBody = Static<typeof CreateUploadBody>;

export const CreatePhotoBody = Type.Object(
	{
		originalKey: Type.String({ minLength: 1, maxLength: 512 }),
		title: Type.Optional(Type.String({ maxLength: 200 })),
		description: Type.Optional(Type.String({ maxLength: 2000 })),
		width: Type.Optional(Type.Integer({ minimum: 1 })),
		height: Type.Optional(Type.Integer({ minimum: 1 })),
		takenAt: Type.Optional(IsoDateTimeString),
		location: Type.Optional(Type.String({ maxLength: 200 })),
		visibility: Type.Optional(VisibilityEnum),
		availability: Type.Optional(AvailabilityEnum),
		priceCents: Type.Optional(Type.Integer({ minimum: 0 })),
		currency: Type.Optional(Type.String({ pattern: "^[A-Z]{3}$" })),
		photographerId: Type.Optional(Type.Union([Type.String({ pattern: UUID_PATTERN }), Type.Null()])),
		sha256: Type.Optional(Type.String({ pattern: "^[A-Fa-f0-9]{64}$" })),
		// Compatibility fields sent by the admin upload form. They are accepted so
		// the live transport does not fail strict validation, but not stored:
		// `category` is a free-form string in the form while the API models
		// categories as M:N rows (assignment endpoints are a follow-up), and there
		// is no per-photo watermark flag (watermarking is album-type/global driven).
		category: Type.Optional(Type.Union([Type.String({ maxLength: 100 }), Type.Null()])),
		watermarked: Type.Optional(Type.Boolean()),
	},
	StrictObject,
);

export type CreatePhotoBody = Static<typeof CreatePhotoBody>;

export const UpdatePhotoBody = Type.Object(
	{
		title: OptionalOrNull(Type.String({ maxLength: 200 })),
		description: OptionalOrNull(Type.String({ maxLength: 2000 })),
		takenAt: OptionalOrNull(IsoDateTimeString),
		location: OptionalOrNull(Type.String({ maxLength: 200 })),
		visibility: Type.Optional(VisibilityEnum),
		availability: Type.Optional(AvailabilityEnum),
		priceCents: OptionalOrNull(Type.Integer({ minimum: 0 })),
		currency: Type.Optional(Type.String({ pattern: "^[A-Z]{3}$" })),
		photographerId: OptionalOrNull(Type.String({ pattern: UUID_PATTERN })),
	},
	StrictObject,
);

export type UpdatePhotoBody = Static<typeof UpdatePhotoBody>;

export const ListPhotosQuery = Type.Object(
	{
		...PaginationQuery.properties,
		status: Type.Optional(PhotoStatusEnum),
		visibility: Type.Optional(VisibilityEnum),
		availability: Type.Optional(AvailabilityEnum),
		uploadStatus: Type.Optional(UploadStatusEnum),
		photographerId: Type.Optional(Type.String({ pattern: UUID_PATTERN })),
		q: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
	},
	StrictObject,
);

export type ListPhotosQuery = Static<typeof ListPhotosQuery>;

export { IdParams };
