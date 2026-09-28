import type { FastifyInstance } from "fastify";
import { hashPassword } from "../auth/password.js";
import type { Role, UserStatus } from "@prisma/client";
import type { MockPrisma } from "./prisma-mock.js";

export interface SeedUser {
	email: string;
	name?: string;
	password?: string;
	role?: Role;
	status?: UserStatus;
}

export async function seedUser(mock: MockPrisma, input: SeedUser): Promise<{ id: string; email: string }> {
	const { randomUUID } = await import("node:crypto");
	const created = mock.user.create({
		data: {
			id: randomUUID(),
			email: input.email.trim().toLowerCase(),
			name: input.name ?? "Test User",
			passwordHash: await hashPassword(input.password ?? "Correct Horse 12"),
			role: input.role ?? "ADMIN",
			status: input.status ?? "ACTIVE",
			bio: null,
			avatarKey: null,
			createdAt: new Date(),
			updatedAt: new Date(),
		},
	});

	return { id: created.id as string, email: created.email as string };
}

// Creates an active session row directly and returns the raw cookie value.
// Dynamic import keeps this helper free of the mocked db module at load time.
export async function seedSession(mock: MockPrisma, userId: string): Promise<string> {
	const { generateSessionToken, hashSessionToken } = await import("../auth/session.js");
	const token = generateSessionToken();

	mock.session.create({
		data: {
			id: `sess_test_${token.slice(0, 8)}`,
			tokenHash: hashSessionToken(token),
			userId,
			expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
			lastSeenAt: new Date(),
			revokedAt: null,
			ipHash: null,
			uaHash: null,
			createdAt: new Date(),
		},
	});

	return token;
}

export function sessionCookie(token: string): string {
	return `__Host-nostos.sid=${token}`;
}

export async function loginCookie(
	app: FastifyInstance,
	email: string,
	password: string,
): Promise<string> {
	const response = await app.inject({
		method: "POST",
		url: "/v1/auth/login",
		payload: { email, password },
	});

	if (response.statusCode !== 200) {
		throw new Error(`Login failed with status ${response.statusCode}: ${response.body}`);
	}

	const setCookie = response.headers["set-cookie"];

	if (!setCookie) {
		throw new Error("Login response did not set a session cookie");
	}

	const first = Array.isArray(setCookie) ? setCookie[0] : setCookie;

	return first.split(";")[0];
}

export function auditActions(mock: MockPrisma): string[] {
	return mock.auditLog.rows.map((row) => String(row.action));
}
