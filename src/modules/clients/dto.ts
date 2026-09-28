import type { ActivityKind, Client, ClientActivity, ClientStatus, LeadSource } from "@prisma/client";

export interface ClientDTO {
	id: string;
	clientCode: string;
	name: string;
	email: string;
	phone: string | null;
	company: string | null;
	notes: string | null;
	status: ClientStatus;
	taxId: string | null;
	address: string | null;
	source: LeadSource | null;
	lastContactAt: string | null;
	deletedAt: string | null;
	createdAt: string;
	updatedAt: string;
}

export function toClientDTO(client: Client): ClientDTO {
	return {
		id: client.id,
		clientCode: client.clientCode,
		name: client.name,
		email: client.email,
		phone: client.phone,
		company: client.company,
		notes: client.notes,
		status: client.status,
		taxId: client.taxId,
		address: client.address,
		source: client.source,
		lastContactAt: client.lastContactAt?.toISOString() ?? null,
		deletedAt: client.deletedAt?.toISOString() ?? null,
		createdAt: client.createdAt.toISOString(),
		updatedAt: client.updatedAt.toISOString(),
	};
}

export interface ClientList {
	items: ClientDTO[];
	page: number;
	pageSize: number;
	total: number;
}

export interface ClientActivityDTO {
	id: string;
	clientId: string;
	kind: ActivityKind;
	title: string;
	body: string | null;
	href: string | null;
	authorId: string | null;
	createdAt: string;
}

export function toClientActivityDTO(activity: ClientActivity): ClientActivityDTO {
	return {
		id: activity.id,
		clientId: activity.clientId,
		kind: activity.kind,
		title: activity.title,
		body: activity.body,
		href: activity.href,
		authorId: activity.authorId,
		createdAt: activity.createdAt.toISOString(),
	};
}

export interface ClientActivityList {
	items: ClientActivityDTO[];
	page: number;
	pageSize: number;
	total: number;
}
