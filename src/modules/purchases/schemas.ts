import { Type } from "typebox";
import type { Static } from "typebox";
import {
	IdParams,
	OptionalOrNull,
	PaginationQuery,
	PurchaseScopeEnum,
	PurchaseStatusEnum,
	UUID_PATTERN,
} from "../../validation/common.js";

const StrictObject = { additionalProperties: false } as const;

const UuidString = Type.String({ pattern: UUID_PATTERN });

export const CreatePurchaseBody = Type.Object(
	{
		clientId: UuidString,
		albumId: UuidString,
		scope: PurchaseScopeEnum,
		// PHOTO/PACK purchases carry their photo identity; which fields are
		// required is validated against the scope in the service.
		photoId: Type.Optional(UuidString),
		packPhotoIds: Type.Optional(Type.Array(UuidString, { minItems: 1, maxItems: 1000 })),
		priceCents: Type.Integer({ minimum: 0 }),
		currency: Type.Optional(Type.String({ pattern: "^[A-Z]{3}$" })),
		note: Type.Optional(Type.String({ maxLength: 1000 })),
	},
	StrictObject,
);

export type CreatePurchaseBody = Static<typeof CreatePurchaseBody>;

export const UpdatePurchaseBody = Type.Object(
	{
		status: Type.Optional(PurchaseStatusEnum),
		note: OptionalOrNull(Type.String({ maxLength: 1000 })),
	},
	StrictObject,
);

export type UpdatePurchaseBody = Static<typeof UpdatePurchaseBody>;

export const ListPurchasesQuery = Type.Object(
	{
		...PaginationQuery.properties,
		clientId: Type.Optional(UuidString),
		albumId: Type.Optional(UuidString),
		status: Type.Optional(PurchaseStatusEnum),
		scope: Type.Optional(PurchaseScopeEnum),
	},
	StrictObject,
);

export type ListPurchasesQuery = Static<typeof ListPurchasesQuery>;

export { IdParams };
