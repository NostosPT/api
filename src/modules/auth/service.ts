import { createHash } from "node:crypto";
import { logAudit } from "../../audit/log.js";
import {
	generateSessionToken,
	hashSessionToken,
	revokeAllSessions,
	revokeSession,
	type AuthenticatedUser,
} from "../../auth/session.js";
import { hashPassword, verifyPassword } from "../../auth/password.js";
import { config } from "../../config/index.js";
import { AuthenticationError, ConflictError } from "../../errors/appError.js";
import { normalizeEmail } from "../../validation/common.js";
import { toUserDTO, type UserDTO } from "../users/dto.js";
import { findUserByEmail } from "../users/repository.js";
import { consumeInviteToken } from "../invites/service.js";
import { createUser } from "../users/repository.js";
import {
	countActiveSessions,
	createSession,
	revokeOldestSessionsBeyond,
} from "./repository.js";

const GENERIC_CREDENTIALS_ERROR = "Invalid email or password";

let dummyHash: string | null = null;

// Verifies against a stable dummy hash so unknown emails cost the same as a
// real password check (timing side-channel mitigation for enumeration).
async function verifyAgainstDummy(password: string): Promise<void> {
	if (dummyHash === null) {
		dummyHash = await hashPassword("invalid-credentials-dummy-value");
	}

	await verifyPassword(dummyHash, password);
}

function emailFingerprint(email: string): string {
	return createHash("sha256").update(email, "utf8").digest("hex");
}

export interface LoginResult {
	user: UserDTO;
	token: string;
	maxAgeSeconds: number;
}

export async function login(input: { email: string; password: string }): Promise<LoginResult> {
	const email = normalizeEmail(input.email);
	const user = await findUserByEmail(email);

	if (user === null) {
		await verifyAgainstDummy(input.password);
		await logAudit({
			action: "auth.login.failure",
			resourceType: "session",
			resourceId: "unknown",
			result: "FAILURE",
			metadata: { emailFingerprint: emailFingerprint(email) },
		});
		throw new AuthenticationError(GENERIC_CREDENTIALS_ERROR);
	}

	const passwordOk = await verifyPassword(user.passwordHash, input.password);

	if (!passwordOk || user.status !== "ACTIVE") {
		await logAudit({
			action: "auth.login.failure",
			resourceType: "session",
			resourceId: user.id,
			result: "FAILURE",
			metadata: null,
		});
		throw new AuthenticationError(GENERIC_CREDENTIALS_ERROR);
	}

	const maxSessions = config.env.SESSION_MAX_CONCURRENT;

	if ((await countActiveSessions(user.id)) >= maxSessions) {
		await revokeOldestSessionsBeyond(user.id, maxSessions - 1);
	}

	const token = generateSessionToken();

	await createSession({
		tokenHash: hashSessionToken(token),
		userId: user.id,
		expiresAt: new Date(Date.now() + config.env.SESSION_ABSOLUTE_SECONDS * 1000),
	});

	await logAudit({
		actorId: user.id,
		action: "auth.login.success",
		resourceType: "session",
		resourceId: user.id,
		result: "SUCCESS",
		metadata: null,
	});

	return {
		user: toUserDTO(user),
		token,
		maxAgeSeconds: config.env.SESSION_ABSOLUTE_SECONDS,
	};
}

export async function logout(userId: string, token: string): Promise<void> {
	await revokeSession(token);

	await logAudit({
		actorId: userId,
		action: "auth.logout",
		resourceType: "session",
		resourceId: userId,
		result: "SUCCESS",
		metadata: null,
	});
}

export async function logoutEverywhere(userId: string): Promise<number> {
	const revoked = await revokeAllSessions(userId);

	await logAudit({
		actorId: userId,
		action: "auth.logout_all",
		resourceType: "session",
		resourceId: userId,
		result: "SUCCESS",
		metadata: { revokedSessions: revoked },
	});

	return revoked;
}

export function currentUser(user: AuthenticatedUser): AuthenticatedUser {
	return user;
}

export interface AcceptInviteInput {
	token: string;
	name: string;
	password: string;
}

export async function acceptInvite(input: AcceptInviteInput): Promise<UserDTO> {
	const { inviteId, email, role } = await consumeInviteToken(input.token);

	const existing = await findUserByEmail(email);

	if (existing !== null) {
		throw new ConflictError("Email already registered");
	}

	const user = await createUser({
		email,
		name: input.name.trim(),
		passwordHash: await hashPassword(input.password),
		role,
	});

	await logAudit({
		actorId: user.id,
		action: "invites.accept",
		resourceType: "invite",
		resourceId: inviteId,
		result: "SUCCESS",
		metadata: null,
	});

	await logAudit({
		actorId: user.id,
		action: "users.create",
		resourceType: "user",
		resourceId: user.id,
		result: "SUCCESS",
		metadata: { role: user.role, viaInvite: true },
	});

	return toUserDTO(user);
}
