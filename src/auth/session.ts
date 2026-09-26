import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { User } from "@prisma/client";
import { prisma } from "../db/prisma.js";

// Reusable session primitives for the approved opaque-session model:
//
//	opaque 256-bit token (HttpOnly cookie)
//	      ↓ SHA-512 hex
//	Session.tokenHash (database)
//	      ↓ lookup + expiry/revocation checks
//	current staff user
//
// No login/register endpoints here — those arrive with business routes.

export const SESSION_COOKIE_NAME = "__Host-nostos.sid";
export const SESSION_TOKEN_BYTES = 32;

// 256-bit cryptographically random token, hex-encoded (64 chars).
export function generateSessionToken(): string {
	return randomBytes(SESSION_TOKEN_BYTES).toString("hex");
}

// SHA-512 hex digest (128 chars). Only the hash is persisted.
export function hashSessionToken(token: string): string {
	return createHash("sha512").update(token, "utf8").digest("hex");
}

// Constant-time comparison against a stored hash.
export function verifySessionToken(token: string, expectedHash: string): boolean {
	const actualHash = hashSessionToken(token);

	if (actualHash.length !== expectedHash.length) {
		return false;
	}

	return timingSafeEqual(Buffer.from(actualHash, "utf8"), Buffer.from(expectedHash, "utf8"));
}

export interface SessionCookieAttributes {
	httpOnly: true;
	secure: boolean;
	sameSite: "lax";
	path: "/";
	maxAgeSeconds: number;
}

// API-host scoped cookie. `secure` follows the deployment (always true in
// production for the `__Host-` prefix requirements: Secure, Path=/, no Domain).
export function sessionCookieAttributes(secure: boolean, maxAgeSeconds: number): SessionCookieAttributes {
	return {
		httpOnly: true,
		secure,
		sameSite: "lax",
		path: "/",
		maxAgeSeconds,
	};
}

export type AuthenticatedUser = Pick<User, "id" | "email" | "name" | "role" | "status">;

// Resolves a raw cookie token to the current staff user, or null when the
// session is unknown, revoked, expired, or belongs to a suspended user.
export async function findSessionUser(token: string): Promise<AuthenticatedUser | null> {
	const tokenHash = hashSessionToken(token);

	const session = await prisma.session.findUnique({
		where: { tokenHash },
		include: {
			user: {
				select: {
					id: true,
					email: true,
					name: true,
					role: true,
					status: true,
				},
			},
		},
	});

	if (session === null || session.revokedAt !== null || session.expiresAt <= new Date()) {
		return null;
	}

	if (session.user.status !== "ACTIVE") {
		return null;
	}

	return session.user;
}

// Revokes a single session by raw token. Idempotent.
export async function revokeSession(token: string): Promise<void> {
	await prisma.session.updateMany({
		where: { tokenHash: hashSessionToken(token), revokedAt: null },
		data: { revokedAt: new Date() },
	});
}

// Revokes every active session of a user (logout everywhere, password or
// privilege change). Returns the revoked count.
export async function revokeAllSessions(userId: string): Promise<number> {
	const result = await prisma.session.updateMany({
		where: { userId, revokedAt: null },
		data: { revokedAt: new Date() },
	});

	return result.count;
}
