import { Type } from "typebox";
import type { Static } from "typebox";
import {
	ClientStatusEnum,
	EmailString,
	IdParams,
	LeadSourceEnum,
	OptionalOrNull,
	PaginationQuery,
} from "../../validation/common.js";

const StrictObject = { additionalProperties: false } as const;

// Portuguese NIF: nine digits, matching the client form validation.
const TaxIdString = Type.String({ pattern: "^\\d{9}$" });

export const CreateClientBody = Type.Object(
	{
		name: Type.String({ minLength: 1, maxLength: 200 }),
		email: EmailString,
		phone: Type.Optional(Type.String({ maxLength: 30 })),
		company: Type.Optional(Type.String({ maxLength: 200 })),
		notes: Type.Optional(Type.String({ maxLength: 5000 })),
		status: Type.Optional(ClientStatusEnum),
		taxId: Type.Optional(TaxIdString),
		address: Type.Optional(Type.String({ maxLength: 500 })),
		source: Type.Optional(LeadSourceEnum),
	},
	StrictObject,
);

export type CreateClientBody = Static<typeof CreateClientBody>;

export const UpdateClientBody = Type.Object(
	{
		name: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
		email: Type.Optional(EmailString),
		phone: OptionalOrNull(Type.String({ maxLength: 30 })),
		company: OptionalOrNull(Type.String({ maxLength: 200 })),
		notes: OptionalOrNull(Type.String({ maxLength: 5000 })),
		status: Type.Optional(ClientStatusEnum),
		taxId: OptionalOrNull(TaxIdString),
		address: OptionalOrNull(Type.String({ maxLength: 500 })),
		source: OptionalOrNull(LeadSourceEnum),
	},
	StrictObject,
);

export type UpdateClientBody = Static<typeof UpdateClientBody>;

export const ListClientsQuery = Type.Object(
	{
		...PaginationQuery.properties,
		status: Type.Optional(ClientStatusEnum),
		q: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
		archived: Type.Optional(Type.Boolean()),
	},
	StrictObject,
);

export type ListClientsQuery = Static<typeof ListClientsQuery>;

export { IdParams, PaginationQuery };
