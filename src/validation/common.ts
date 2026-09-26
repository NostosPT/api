import { Type } from "typebox";
import type { Static } from "typebox";

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
