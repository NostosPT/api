import { Type } from "typebox";
import type { Static } from "typebox";
import type { Role, UserStatus } from "@prisma/client";

const UUID_PATTERN = "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$";

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

export function normalizeEmail(email: string): string {
	return email.trim().toLowerCase();
}
