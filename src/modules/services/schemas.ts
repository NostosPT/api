import { Type } from "typebox";
import type { Static } from "typebox";
import { IdParams, PaginationQuery } from "../../validation/common.js";

export const CreateServiceBody = Type.Object(
	{
		slug: Type.String({ pattern: "^[a-z0-9-]+$", minLength: 1, maxLength: 64 }),
		name: Type.String({ minLength: 1, maxLength: 120 }),
		description: Type.Optional(Type.String({ maxLength: 500 })),
		priceFromCents: Type.Optional(Type.Integer({ minimum: 0 })),
		priceToCents: Type.Optional(Type.Integer({ minimum: 0 })),
		currency: Type.Optional(Type.String({ pattern: "^[A-Z]{3}$", default: "EUR" })),
		active: Type.Optional(Type.Boolean({ default: true })),
	},
	{ additionalProperties: false },
);

export type CreateServiceBody = Static<typeof CreateServiceBody>;

export const UpdateServiceBody = Type.Object(
	{
		name: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
		description: Type.Optional(Type.String({ maxLength: 500 })),
		priceFromCents: Type.Optional(Type.Integer({ minimum: 0 })),
		priceToCents: Type.Optional(Type.Integer({ minimum: 0 })),
		currency: Type.Optional(Type.String({ pattern: "^[A-Z]{3}$" })),
		active: Type.Optional(Type.Boolean()),
	},
	{ additionalProperties: false },
);

export type UpdateServiceBody = Static<typeof UpdateServiceBody>;

export { IdParams, PaginationQuery };