import { Type } from "typebox";
import type { Static, TSchema } from "typebox";
import {
	EmailString,
	IdParams,
	LeadSourceEnum,
	PaginationQuery,
	ServiceRequestStageEnum,
	UUID_PATTERN,
} from "../../validation/common.js";

// Pattern (not `format: "date-time"`) so validation works without ajv-formats.
const ISODateTime = Type.String({
	pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,3})?(Z|[+-]\\d{2}:\\d{2})$",
});

function OptionalOrNull<T extends TSchema>(schema: T) {
	return Type.Optional(Type.Union([schema, Type.Null()]));
}

const ContactBody = Type.Object(
	{
		name: Type.Optional(Type.String({ maxLength: 120 })),
		email: EmailString,
		phone: Type.Optional(Type.String({ maxLength: 30 })),
		instagram: Type.Optional(Type.String({ maxLength: 100 })),
		preferredContact: Type.Optional(Type.String({ maxLength: 30 })),
	},
	{ additionalProperties: false },
);

export const CreateServiceRequestBody = Type.Object(
	{
		service: Type.String({ minLength: 1, maxLength: 64 }),
		preferredDate: Type.Optional(ISODateTime),
		location: Type.Optional(Type.String({ maxLength: 200 })),
		locationUndecided: Type.Optional(Type.Boolean()),
		budgetMin: Type.Optional(Type.Number({ minimum: 0 })),
		budgetMax: Type.Optional(Type.Number({ minimum: 0 })),
		contact: ContactBody,
		answers: Type.Optional(Type.Record(Type.String(), Type.String())),
		referenceKeys: Type.Optional(Type.Array(Type.String())),
	},
	{ additionalProperties: false },
);

export type CreateServiceRequestBody = Static<typeof CreateServiceRequestBody>;

export const UpdateServiceRequestBody = Type.Object(
	{
		title: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
		stage: Type.Optional(ServiceRequestStageEnum),
		preferredDate: OptionalOrNull(ISODateTime),
		location: OptionalOrNull(Type.String({ maxLength: 200 })),
		locationUndecided: Type.Optional(Type.Boolean()),
		budgetMinCents: OptionalOrNull(Type.Integer({ minimum: 0 })),
		budgetMaxCents: OptionalOrNull(Type.Integer({ minimum: 0 })),
		estimateFromCents: OptionalOrNull(Type.Integer({ minimum: 0 })),
		estimateToCents: OptionalOrNull(Type.Integer({ minimum: 0 })),
		quoteCents: OptionalOrNull(Type.Integer({ minimum: 0 })),
		quoteId: OptionalOrNull(Type.String({ maxLength: 100 })),
		assigneeId: OptionalOrNull(Type.String({ pattern: UUID_PATTERN })),
		source: OptionalOrNull(LeadSourceEnum),
		lostReason: OptionalOrNull(Type.String({ maxLength: 500 })),
		contact: Type.Optional(ContactBody),
		answers: Type.Optional(Type.Record(Type.String(), Type.String())),
		referenceKeys: Type.Optional(Type.Array(Type.String())),
	},
	{ additionalProperties: false },
);

export type UpdateServiceRequestBody = Static<typeof UpdateServiceRequestBody>;

export const ListServiceRequestsQuery = Type.Object(
	{
		...PaginationQuery.properties,
		stage: Type.Optional(ServiceRequestStageEnum),
		serviceId: Type.Optional(Type.String({ pattern: UUID_PATTERN })),
		assigneeId: Type.Optional(Type.String({ pattern: UUID_PATTERN })),
		clientId: Type.Optional(Type.String({ pattern: UUID_PATTERN })),
	},
	{ additionalProperties: false },
);

export type ListServiceRequestsQuery = Static<typeof ListServiceRequestsQuery>;

export const AddNoteBody = Type.Object(
	{
		body: Type.String({ minLength: 1, maxLength: 5000 }),
	},
	{ additionalProperties: false },
);

export type AddNoteBody = Static<typeof AddNoteBody>;

export { IdParams };
