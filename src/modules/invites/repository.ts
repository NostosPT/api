import type { Invite, Role } from "@prisma/client";
import { prisma } from "../../db/prisma.js";

export interface CreateInviteInput {
	email: string;
	role: Role;
	tokenHash: string;
	invitedById: string;
	expiresAt: Date;
}

export async function findInviteById(id: string): Promise<Invite | null> {
	return prisma.invite.findUnique({ where: { id } });
}

export async function findInviteByTokenHash(tokenHash: string): Promise<Invite | null> {
	return prisma.invite.findUnique({ where: { tokenHash } });
}

export async function findPendingInviteByEmail(email: string): Promise<Invite | null> {
	return prisma.invite.findFirst({
		where: {
			email,
			acceptedAt: null,
			expiresAt: { gt: new Date() },
		},
	});
}

export async function listInvites(skip: number, take: number): Promise<Invite[]> {
	return prisma.invite.findMany({
		skip,
		take,
		orderBy: { createdAt: "desc" },
	});
}

export async function countInvites(): Promise<number> {
	return prisma.invite.count();
}

export async function createInvite(input: CreateInviteInput): Promise<Invite> {
	return prisma.invite.create({
		data: {
			email: input.email,
			role: input.role,
			tokenHash: input.tokenHash,
			invitedById: input.invitedById,
			expiresAt: input.expiresAt,
		},
	});
}

export async function markInviteAccepted(id: string): Promise<Invite> {
	return prisma.invite.update({
		where: { id },
		data: { acceptedAt: new Date() },
	});
}

export async function deleteInvite(id: string): Promise<void> {
	await prisma.invite.delete({ where: { id } });
}
