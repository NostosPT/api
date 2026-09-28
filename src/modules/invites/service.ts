import type { Role } from "@prisma/client";
import { logAudit } from "../../audit/log.js";
import {
	generateSessionToken,
	hashSessionToken,
} from "../../auth/session.js";
import { ConflictError, NotFoundError } from "../../errors/appError.js";
import { normalizeEmail } from "../../validation/common.js";
import { findUserByEmail } from "../users/repository.js";
import { toInviteDTO, type CreatedInvite, type InviteDTO } from "./dto.js";
import {
	countInvites,
	createInvite,
	deleteInvite,
	findInviteById,
	findInviteByTokenHash,
	findPendingInviteByEmail,
	listInvites,
	markInviteAccepted,
} from "./repository.js";

export const INVITE_TTL_SECONDS = 7 * 24 * 60 * 60;

export interface CreateInviteRequest {
	email: string;
	role: Role;
}

export interface InviteList {
	items: InviteDTO[];
	page: number;
	pageSize: number;
	total: number;
}

export async function createStaffInvite(
	actorId: string,
	input: CreateInviteRequest,
): Promise<CreatedInvite> {
	const email = normalizeEmail(input.email);

	const existingUser = await findUserByEmail(email);

	if (existingUser !== null) {
		throw new ConflictError("Email already registered");
	}

	const pending = await findPendingInviteByEmail(email);

	if (pending !== null) {
		throw new ConflictError("Pending invite already exists");
	}

	const token = generateSessionToken();

	const invite = await createInvite({
		email,
		role: input.role,
		tokenHash: hashSessionToken(token),
		invitedById: actorId,
		expiresAt: new Date(Date.now() + INVITE_TTL_SECONDS * 1000),
	});

	await logAudit({
		actorId,
		action: "invites.create",
		resourceType: "invite",
		resourceId: invite.id,
		result: "SUCCESS",
		metadata: { role: invite.role },
	});

	return { ...toInviteDTO(invite), token };
}

export async function listStaffInvites(page: number, pageSize: number): Promise<InviteList> {
	const [items, total] = await Promise.all([
		listInvites((page - 1) * pageSize, pageSize),
		countInvites(),
	]);

	return { items: items.map(toInviteDTO), page, pageSize, total };
}

export async function removeInvite(actorId: string, id: string): Promise<void> {
	const invite = await findInviteById(id);

	if (invite === null) {
		throw new NotFoundError("Invite not found");
	}

	await deleteInvite(id);

	await logAudit({
		actorId,
		action: "invites.delete",
		resourceType: "invite",
		resourceId: id,
		result: "SUCCESS",
		metadata: null,
	});
}

export interface AcceptInviteRequest {
	token: string;
	name: string;
	password: string;
}

export interface AcceptedInvite {
	inviteId: string;
	email: string;
	role: Role;
}

// Validates an invite token without revealing whether it exists or expired.
export async function validateInviteToken(token: string) {
	const invite = await findInviteByTokenHash(hashSessionToken(token));

	// Loose null check: real rows carry NULL, never undefined.
	if (invite === null || invite.acceptedAt != null || invite.expiresAt <= new Date()) {
		throw new NotFoundError("Invite not found or expired");
	}

	return invite;
}

export async function consumeInviteToken(token: string): Promise<AcceptedInvite> {
	const invite = await validateInviteToken(token);
	const accepted = await markInviteAccepted(invite.id);

	return { inviteId: accepted.id, email: accepted.email, role: accepted.role };
}
