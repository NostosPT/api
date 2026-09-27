import { Type } from "typebox";
import type { Static, TLiteral, TSchema } from "typebox";
import type { Role, UserStatus, ServiceRequestStage, LeadSource, ClientStatus, TagStatus, TagVisibility, PhotoStatus, Visibility, Availability, UploadStatus, AlbumType, AlbumStatus } from "@prisma/client";

export const UUID_PATTERN = "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$";

// Pattern (not `format: "uuid"`) so validation works without ajv-formats.
export const IdParams = Type.Object({
	id: Type.String({ pattern: UUID_PATTERN }),
});

export type IdParams = Static<typeof IdParams>;

export const PaginationQuery = Type.Object({
	page: Type.Optional(Type.Integer({ minimum: 1, default: 1 })),
	pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 20 })),
});

export type PaginationQuery = Static<typeof PaginationQuery>;

// Shared primitives. Email uses a pattern (not `format: "email"`) so
// validation works without ajv-formats.
export const EmailString = Type.String({
	pattern: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$",
	maxLength: 254,
});

export const PasswordString = Type.String({ minLength: 12, maxLength: 128 });

export const RoleEnum = Type.Union(
	(["ADMIN", "PHOTOGRAPHER", "EDITOR", "ASSISTANT", "ACCOUNTANT"] as Role[]).map((role) =>
		Type.Literal(role),
	),
);

export const UserStatusEnum = Type.Union(
	(["ACTIVE", "SUSPENDED"] as UserStatus[]).map((status) => Type.Literal(status)),
);

// Built from a const tuple (not `.map()`): TypeBox cannot infer a Static
// union from a plain array, which would collapse these to `never`.
const serviceRequestStageLiterals = [
	Type.Literal("NEW"),
	Type.Literal("QUALIFIED"),
	Type.Literal("QUOTED"),
	Type.Literal("BOOKED"),
	Type.Literal("COMPLETED"),
	Type.Literal("LOST"),
] as const satisfies readonly TLiteral<ServiceRequestStage>[];

const leadSourceLiterals = [
	Type.Literal("WEBSITE"),
	Type.Literal("EMAIL"),
	Type.Literal("REFERRAL"),
	Type.Literal("INSTAGRAM"),
	Type.Literal("ARCHIVE"),
] as const satisfies readonly TLiteral<LeadSource>[];

const clientStatusLiterals = [
	Type.Literal("LEAD"),
	Type.Literal("ACTIVE"),
	Type.Literal("PAST"),
] as const satisfies readonly TLiteral<ClientStatus>[];

export const ServiceRequestStageEnum = Type.Union([...serviceRequestStageLiterals]);

export const LeadSourceEnum = Type.Union([...leadSourceLiterals]);

export const ClientStatusEnum = Type.Union([...clientStatusLiterals]);

// Tag and Category statuses are both ACTIVE|INACTIVE; one literal tuple
// feeds both exports so the unions stay in lockstep.
const activeInactiveLiterals = [
	Type.Literal("ACTIVE"),
	Type.Literal("INACTIVE"),
] as const satisfies readonly TLiteral<TagStatus>[];

const tagVisibilityLiterals = [
	Type.Literal("PUBLIC"),
	Type.Literal("INTERNAL"),
] as const satisfies readonly TLiteral<TagVisibility>[];

export const TagStatusEnum = Type.Union([...activeInactiveLiterals]);

export const CategoryStatusEnum = Type.Union([...activeInactiveLiterals]);

export const TagVisibilityEnum = Type.Union([...tagVisibilityLiterals]);

const photoStatusLiterals = [
	Type.Literal("DRAFT"),
	Type.Literal("APPROVED"),
	Type.Literal("PUBLISHED"),
] as const satisfies readonly TLiteral<PhotoStatus>[];

const visibilityLiterals = [
	Type.Literal("PUBLIC"),
	Type.Literal("UNLISTED"),
	Type.Literal("PRIVATE"),
] as const satisfies readonly TLiteral<Visibility>[];

const availabilityLiterals = [
	Type.Literal("NOT_FOR_SALE"),
	Type.Literal("AVAILABLE"),
	Type.Literal("SOLD_OUT"),
] as const satisfies readonly TLiteral<Availability>[];

const uploadStatusLiterals = [
	Type.Literal("PENDING"),
	Type.Literal("READY"),
	Type.Literal("FAILED"),
] as const satisfies readonly TLiteral<UploadStatus>[];

export const PhotoStatusEnum = Type.Union([...photoStatusLiterals]);

export const VisibilityEnum = Type.Union([...visibilityLiterals]);

export const AvailabilityEnum = Type.Union([...availabilityLiterals]);

export const UploadStatusEnum = Type.Union([...uploadStatusLiterals]);

export const SlugString = Type.String({ pattern: "^[a-z0-9-]+$", minLength: 1, maxLength: 64 });

const albumTypeLiterals = [
	Type.Literal("WATERMARK"),
	Type.Literal("PAID"),
	Type.Literal("FREE"),
] as const satisfies readonly TLiteral<AlbumType>[];

const albumStatusLiterals = [
	Type.Literal("DRAFT"),
	Type.Literal("PUBLISHED"),
	Type.Literal("ARCHIVED"),
] as const satisfies readonly TLiteral<AlbumStatus>[];

export const AlbumTypeEnum = Type.Union([...albumTypeLiterals]);

export const AlbumStatusEnum = Type.Union([...albumStatusLiterals]);

// Pattern (not `format: "date-time"`) so validation works without ajv-formats.
export const IsoDateTimeString = Type.String({
	pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,3})?(Z|[+-]\\d{2}:\\d{2})$",
});

// Optional field that also accepts explicit null so PATCH bodies can clear
// stored nullable values.
export function OptionalOrNull<T extends TSchema>(schema: T) {
	return Type.Optional(Type.Union([schema, Type.Null()]));
}

export function normalizeEmail(email: string): string {
	return email.trim().toLowerCase();
}
