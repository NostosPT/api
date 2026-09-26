import { Prisma } from "@prisma/client";
import type { Role, User, UserStatus } from "@prisma/client";
import { prisma } from "../../db/prisma.js";
import { ConflictError } from "../../errors/appError.js";

export interface CreateUserInput {
	email: string;
	name: string;
	passwordHash: string;
	role: Role;
}

export interface UpdateUserInput {
	name?: string;
	role?: Role;
	status?: UserStatus;
}

function mapUniqueViolation(error: unknown, message: string): void {
	if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
		throw new ConflictError(message);
	}

	throw error;
}

export async function findUserByEmail(email: string): Promise<User | null> {
	return prisma.user.findUnique({ where: { email } });
}

export async function findUserById(id: string): Promise<User | null> {
	return prisma.user.findUnique({ where: { id } });
}

export async function listUsers(skip: number, take: number): Promise<User[]> {
	return prisma.user.findMany({
		skip,
		take,
		orderBy: { createdAt: "desc" },
	});
}

export async function countUsers(): Promise<number> {
	return prisma.user.count();
}

export async function countActiveAdmins(): Promise<number> {
	return prisma.user.count({ where: { role: "ADMIN", status: "ACTIVE" } });
}

export async function createUser(input: CreateUserInput): Promise<User> {
	try {
		return await prisma.user.create({
			data: {
				email: input.email,
				name: input.name,
				passwordHash: input.passwordHash,
				role: input.role,
				status: "ACTIVE",
			},
		});
	}
	catch (error) {
		mapUniqueViolation(error, "Email already registered");
		throw error;
	}
}

export async function updateUser(id: string, patch: UpdateUserInput): Promise<User> {
	return prisma.user.update({
		where: { id },
		data: {
			...(patch.name === undefined ? {} : { name: patch.name }),
			...(patch.role === undefined ? {} : { role: patch.role }),
			...(patch.status === undefined ? {} : { status: patch.status }),
		},
	});
}
