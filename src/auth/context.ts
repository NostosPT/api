import type { Role } from "@prisma/client";
import type { FastifyRequest } from "fastify";
import { config } from "../config/index.js";
import { AuthenticationError, AuthorizationError } from "../errors/appError.js";
import {
	hashSessionToken,
	SESSION_COOKIE_NAME,
	touchSession,
	findSessionUser,
	type AuthenticatedUser,
} from "./session.js";

declare module "fastify" {
	interface FastifyRequest {
		auth?: {
			user: AuthenticatedUser;
			tokenHash: string;
		};
	}
}

// Resolves the session cookie once per request. Protected routes read
// `request.auth` instead of querying the user again.
export async function requireAuth(request: FastifyRequest): Promise<void> {
	const token = request.cookies?.[SESSION_COOKIE_NAME];

	if (!token) {
		throw new AuthenticationError("Authentication required");
	}

	const user: AuthenticatedUser | null = await findSessionUser(token);

	if (user === null) {
		throw new AuthenticationError("Authentication required");
	}

	const tokenHash = hashSessionToken(token);

	request.auth = { user, tokenHash };

	// Lazy idle renewal: single conditional write, only when stale.
	await touchSession(tokenHash, config.env.SESSION_IDLE_SECONDS);
}

// The returned hook is async on purpose: Fastify waits for `done()` on
// synchronous hooks, so a sync authorization closure would hang the request.
export function requireRole(...allowed: Role[]): (request: FastifyRequest) => Promise<void> {
	return async (request: FastifyRequest) => {
		const role = request.auth?.user.role;

		if (role === undefined || !allowed.includes(role)) {
			throw new AuthorizationError("Insufficient permissions");
		}
	};
}
