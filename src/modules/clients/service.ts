import type { Client, ClientStatus, Prisma } from "@prisma/client";
import { logAudit } from "../../audit/log.js";
import { ConflictError, NotFoundError } from "../../errors/appError.js";
import { normalizeEmail } from "../../validation/common.js";
import {
	toClientActivityDTO,
	toClientDTO,
	type ClientActivityList,
	type ClientDTO,
	type ClientList,
} from "./dto.js";
import {
	archiveClient as archiveClientRow,
	countClientActivity,
	countClients,
	createClient as insertClient,
	findClientByEmail,
	findClientById,
	findClientActivity,
	findClients,
	updateClient as updateClientRow,
} from "./repository.js";
import type { CreateClientBody, UpdateClientBody } from "./schemas.js";

async function getClientOrThrow(id: string): Promise<Client> {
	const client = await findClientById(id);

	if (client === null) {
		throw new NotFoundError("Client not found");
	}

	return client;
}

export interface ClientFilters {
	status?: ClientStatus;
	q?: string;
	archived?: boolean;
}

export async function listClients(
	page: number,
	pageSize: number,
	filters: ClientFilters = {},
): Promise<ClientList> {
	// Archived clients (deletedAt set) stay readable but are excluded from the
	// default list; archived=true switches to the archived view (REQUIREMENTS §14b).
	const where: Prisma.ClientWhereInput = {
		...(filters.archived === true ? { deletedAt: { not: null } } : { deletedAt: null }),
		...(filters.status === undefined ? {} : { status: filters.status }),
		...(filters.q === undefined
			? {}
			: {
				OR: [
					{ clientCode: { contains: filters.q, mode: "insensitive" } },
					{ email: { contains: filters.q, mode: "insensitive" } },
					{ name: { contains: filters.q, mode: "insensitive" } },
				],
			}),
	};

	const [items, total] = await Promise.all([
		findClients(where, (page - 1) * pageSize, pageSize),
		countClients(where),
	]);

	return { items: items.map(toClientDTO), page, pageSize, total };
}

export async function getClient(id: string): Promise<ClientDTO> {
	return toClientDTO(await getClientOrThrow(id));
}

export async function getClientActivity(id: string, page: number, pageSize: number): Promise<ClientActivityList> {
	await getClientOrThrow(id);

	const [items, total] = await Promise.all([
		findClientActivity(id, (page - 1) * pageSize, pageSize),
		countClientActivity(id),
	]);

	return { items: items.map(toClientActivityDTO), page, pageSize, total };
}

export async function createClient(actorId: string, input: CreateClientBody): Promise<ClientDTO> {
	const email = normalizeEmail(input.email);
	const existing = await findClientByEmail(email);

	if (existing !== null) {
		throw new ConflictError("Email already registered");
	}

	const client = await insertClient({ ...input, email });

	await logAudit({
		actorId,
		action: "clients.create",
		resourceType: "client",
		resourceId: client.id,
		result: "SUCCESS",
		metadata: { clientCode: client.clientCode, status: client.status },
	});

	return toClientDTO(client);
}

export async function updateClient(actorId: string, id: string, patch: UpdateClientBody): Promise<ClientDTO> {
	const client = await getClientOrThrow(id);

	if (client.deletedAt !== null) {
		throw new ConflictError("Client is archived");
	}

	let email: string | undefined;

	if (patch.email !== undefined) {
		email = normalizeEmail(patch.email);

		if (email !== client.email) {
			const existing = await findClientByEmail(email);

			if (existing !== null && existing.id !== id) {
				throw new ConflictError("Email already registered");
			}
		}
	}

	const updated = await updateClientRow(id, {
		...patch,
		...(email === undefined ? {} : { email }),
		...(patch.name === undefined ? {} : { name: patch.name.trim() }),
	});

	await logAudit({
		actorId,
		action: "clients.update",
		resourceType: "client",
		resourceId: id,
		result: "SUCCESS",
		metadata: {
			clientCode: updated.clientCode,
			...(patch.status === undefined ? {} : { status: patch.status }),
			...(patch.source === undefined ? {} : { source: patch.source }),
		},
	});

	return toClientDTO(updated);
}

export async function deleteClient(actorId: string, id: string): Promise<ClientDTO> {
	const client = await getClientOrThrow(id);

	if (client.deletedAt !== null) {
		throw new ConflictError("Client is already archived");
	}

	const anonymizedEmail = `deleted_${client.id}@archived.invalid`;
	const archived = await archiveClientRow(client.id, anonymizedEmail);

	await logAudit({
		actorId,
		action: "clients.delete",
		resourceType: "client",
		resourceId: id,
		result: "SUCCESS",
		metadata: { clientCode: client.clientCode, emailAnonymized: true },
	});

	return toClientDTO(archived);
}
