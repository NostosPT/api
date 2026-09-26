import type { Role, UserStatus } from "@prisma/client";
import { logAudit } from "../../audit/log.js";
import { hashPassword } from "../../auth/password.js";
import { revokeAllSessions } from "../../auth/session.js";
import { ConflictError, NotFoundError } from "../../errors/appError.js";
import { normalizeEmail } from "../../validation/common.js";
import { toUserDTO, type UserDTO } from "./dto.js";
import {
	countActiveAdmins,
	createUser,
	findUserByEmail,
	findUserById,
	listUsers,
	countUsers,
	updateUser,
} from "./repository.js";

export interface CreateUserRequest {
	email: string;
	name: string;
	password: string;
	role: Role;
}

export interface UpdateUserRequest {
	name?: string;
	role?: Role;
	status?: UserStatus;
}

export interface UserList {
	items: UserDTO[];
	page: number;
	pageSize: number;
	total: number;
}

async function getExistingUser(id: string) {
	const user = await findUserById(id);

	if (user === null) {
		throw new NotFoundError("User not found");
	}

	return user;
}

// Guards the last active administrator: role removal, suspension and
// deactivation are refused when the target is the final one.
async function assertNotLastAdmin(targetId: string): Promise<void> {
	const target = await getExistingUser(targetId);

	if (target.role !== "ADMIN" || target.status !== "ACTIVE") {
		return;
	}

	const remaining = await countActiveAdmins();

	if (remaining <= 1) {
		throw new ConflictError("Cannot remove the last administrator");
	}
}

export async function listAllUsers(page: number, pageSize: number): Promise<UserList> {
	const [items, total] = await Promise.all([
		listUsers((page - 1) * pageSize, pageSize),
		countUsers(),
	]);

	return { items: items.map(toUserDTO), page, pageSize, total };
}

export async function getUser(id: string): Promise<UserDTO> {
	return toUserDTO(await getExistingUser(id));
}

export async function registerUser(actorId: string, input: CreateUserRequest): Promise<UserDTO> {
	const email = normalizeEmail(input.email);

	const existing = await findUserByEmail(email);

	if (existing !== null) {
		throw new ConflictError("Email already registered");
	}

	const user = await createUser({
		email,
		name: input.name.trim(),
		passwordHash: await hashPassword(input.password),
		role: input.role,
	});

	await logAudit({
		actorId,
		action: "users.create",
		resourceType: "user",
		resourceId: user.id,
		result: "SUCCESS",
		metadata: { role: user.role },
	});

	return toUserDTO(user);
}

export async function modifyUser(actorId: string, targetId: string, patch: UpdateUserRequest): Promise<UserDTO> {
	await getExistingUser(targetId);

	if (actorId === targetId && (patch.role !== undefined || patch.status !== undefined)) {
		throw new ConflictError("Cannot change your own role or status");
	}

	if (patch.role !== undefined && patch.role !== "ADMIN") {
		await assertNotLastAdmin(targetId);
	}

	if (patch.status !== undefined && patch.status !== "ACTIVE") {
		await assertNotLastAdmin(targetId);
	}

	const user = await updateUser(targetId, patch);

	await logAudit({
		actorId,
		action: "users.update",
		resourceType: "user",
		resourceId: user.id,
		result: "SUCCESS",
		metadata: {
			...(patch.role === undefined ? {} : { role: patch.role }),
			...(patch.status === undefined ? {} : { status: patch.status }),
		},
	});

	return toUserDTO(user);
}

// DELETE deactivates instead of hard-deleting: sessions are revoked and the
// record (with its audit/history links) is preserved as SUSPENDED.
export async function deactivateUser(actorId: string, targetId: string): Promise<UserDTO> {
	await getExistingUser(targetId);

	if (actorId === targetId) {
		throw new ConflictError("Cannot deactivate your own account");
	}

	await assertNotLastAdmin(targetId);

	const user = await updateUser(targetId, { status: "SUSPENDED" });
	await revokeAllSessions(targetId);

	await logAudit({
		actorId,
		action: "users.delete",
		resourceType: "user",
		resourceId: user.id,
		result: "SUCCESS",
		metadata: { deactivated: true },
	});

	return toUserDTO(user);
}
