import { Prisma } from "@prisma/client";
import type { Client, ClientActivity, ClientStatus, LeadSource } from "@prisma/client";
import { prisma } from "../../db/prisma.js";
import { insertWithCode } from "../../db/sequentialCodes.js";
import { ConflictError } from "../../errors/appError.js";

export interface CreateClientInput {
	name: string;
	email: string;
	phone?: string | null;
	company?: string | null;
	notes?: string | null;
	status?: ClientStatus;
	taxId?: string | null;
	address?: string | null;
	source?: LeadSource | null;
}

export interface UpdateClientInput {
	name?: string;
	email?: string;
	phone?: string | null;
	company?: string | null;
	notes?: string | null;
	status?: ClientStatus;
	taxId?: string | null;
	address?: string | null;
	source?: LeadSource | null;
}

export async function findClientById(id: string): Promise<Client | null> {
	return prisma.client.findUnique({ where: { id } });
}

export async function findClientByEmail(email: string): Promise<Client | null> {
	return prisma.client.findUnique({ where: { email } });
}

export async function findClients(
	where: Prisma.ClientWhereInput = {},
	skip = 0,
	take = 20,
): Promise<Client[]> {
	return prisma.client.findMany({
		where,
		skip,
		take,
		orderBy: { updatedAt: "desc" },
	});
}

export async function countClients(where: Prisma.ClientWhereInput = {}): Promise<number> {
	return prisma.client.count({ where });
}

export async function createClient(input: CreateClientInput): Promise<Client> {
	try {
		return await insertWithCode("CLIENT", (clientCode) => prisma.client.create({
			data: {
				clientCode,
				name: input.name,
				email: input.email,
				phone: input.phone ?? null,
				company: input.company ?? null,
				notes: input.notes ?? null,
				status: input.status ?? "LEAD",
				taxId: input.taxId ?? null,
				address: input.address ?? null,
				source: input.source ?? null,
				lastContactAt: null,
			},
		}));
	}
	catch (error) {
		if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
			throw new ConflictError("Client already exists");
		}
		throw error;
	}
}

export async function updateClient(id: string, patch: UpdateClientInput): Promise<Client> {
	return prisma.client.update({
		where: { id },
		data: {
			...(patch.name === undefined ? {} : { name: patch.name }),
			...(patch.email === undefined ? {} : { email: patch.email }),
			...(patch.phone === undefined ? {} : { phone: patch.phone }),
			...(patch.company === undefined ? {} : { company: patch.company }),
			...(patch.notes === undefined ? {} : { notes: patch.notes }),
			...(patch.status === undefined ? {} : { status: patch.status }),
			...(patch.taxId === undefined ? {} : { taxId: patch.taxId }),
			...(patch.address === undefined ? {} : { address: patch.address }),
			...(patch.source === undefined ? {} : { source: patch.source }),
		},
	});
}

// Deactivation, never a hard delete: history stays linked by id and the
// anonymized email frees the original address for re-registration (REQUIREMENTS §14b).
export async function archiveClient(id: string, anonymizedEmail: string): Promise<Client> {
	return prisma.client.update({
		where: { id },
		data: { deletedAt: new Date(), email: anonymizedEmail },
	});
}

export async function findClientActivity(clientId: string, skip = 0, take = 20): Promise<ClientActivity[]> {
	return prisma.clientActivity.findMany({
		where: { clientId },
		orderBy: { createdAt: "desc" },
		skip,
		take,
	});
}

export async function countClientActivity(clientId: string): Promise<number> {
	return prisma.clientActivity.count({ where: { clientId } });
}
