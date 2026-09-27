import { Type } from "typebox";
import type { Static, TLiteral } from "typebox";
import type { Role, UserStatus, ServiceRequestStage, LeadSource } from "@prisma/client";

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

export const ServiceRequestStageEnum = Type.Union([...serviceRequestStageLiterals]);

export const LeadSourceEnum = Type.Union([...leadSourceLiterals]);

export function normalizeEmail(email: string): string {
	return email.trim().toLowerCase();
}
