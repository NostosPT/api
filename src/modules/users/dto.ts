import type { Role, User, UserStatus } from "@prisma/client";

export interface UserDTO {
	id: string;
	email: string;
	name: string;
	role: Role;
	status: UserStatus;
	createdAt: string;
	updatedAt: string;
}

export function toUserDTO(user: User): UserDTO {
	return {
		id: user.id,
		email: user.email,
		name: user.name,
		role: user.role,
		status: user.status,
		createdAt: user.createdAt.toISOString(),
		updatedAt: user.updatedAt.toISOString(),
	};
}
