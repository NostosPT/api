import type { Invite, Role } from "@prisma/client";

export type InviteStatus = "PENDING" | "ACCEPTED" | "EXPIRED";

export interface InviteDTO {
	id: string;
	email: string;
	role: Role;
	invitedById: string | null;
	status: InviteStatus;
	expiresAt: string;
	acceptedAt: string | null;
	createdAt: string;
}

export function inviteStatusOf(invite: Invite, now: Date = new Date()): InviteStatus {
	if (invite.acceptedAt !== null) {
		return "ACCEPTED";
	}

	if (invite.expiresAt <= now) {
		return "EXPIRED";
	}

	return "PENDING";
}

export function toInviteDTO(invite: Invite): InviteDTO {
	return {
		id: invite.id,
		email: invite.email,
		role: invite.role,
		invitedById: invite.invitedById,
		status: inviteStatusOf(invite),
		expiresAt: invite.expiresAt.toISOString(),
		acceptedAt: invite.acceptedAt?.toISOString() ?? null,
		createdAt: invite.createdAt.toISOString(),
	};
}

export interface CreatedInvite extends InviteDTO {
	// Returned exactly once at creation for out-of-band delivery.
	// Never persisted, never returned by list/detail.
	token: string;
}
