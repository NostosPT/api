import { prisma } from "../../db/prisma.js";

export interface CreateSessionInput {
	tokenHash: string;
	userId: string;
	expiresAt: Date;
}

export async function countActiveSessions(userId: string): Promise<number> {
	return prisma.session.count({
		where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
	});
}

// Revokes the oldest active sessions, keeping at most `keepNewest` of them.
// Used before creating a new session so the concurrency cap holds.
export async function revokeOldestSessionsBeyond(userId: string, keepNewest: number): Promise<void> {
	const active = await prisma.session.findMany({
		where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
		orderBy: { createdAt: "asc" },
		select: { id: true },
	});

	const excess = active.length - keepNewest;

	if (excess <= 0) {
		return;
	}

	const ids = active.slice(0, excess).map((session) => session.id);

	await prisma.session.updateMany({
		where: { id: { in: ids } },
		data: { revokedAt: new Date() },
	});
}

export async function createSession(input: CreateSessionInput): Promise<{ id: string }> {
	const session = await prisma.session.create({
		data: {
			tokenHash: input.tokenHash,
			userId: input.userId,
			expiresAt: input.expiresAt,
		},
		select: { id: true },
	});

	return session;
}
