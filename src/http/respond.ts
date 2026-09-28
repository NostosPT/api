import type { RouteResult } from "../routing/router.js";

// Standard success shapes. Handlers return data directly (200) or one of
// these helpers. Prisma models are never returned here ÔÇö map to explicit
// DTOs at the service boundary before responding.
export function created<T>(data: T): RouteResult {
	return { status: 201, data };
}

export function noContent(): RouteResult {
	return { status: 204, data: undefined };
}
