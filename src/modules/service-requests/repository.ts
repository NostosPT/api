import { Prisma } from "@prisma/client";
import type { ServiceRequest, ServiceRequestStage, LeadSource, Client } from "@prisma/client";
import { prisma } from "../../db/prisma.js";
import { ConflictError } from "../../errors/appError.js";
import { generateNextClientCode } from "../clients/repository.js";

export interface CreateServiceRequestInput {
	reference: string;
	title: string;
	clientId: string;
	serviceId?: string | null;
	stage?: ServiceRequestStage;
	preferredDate?: Date | null;
	location?: string | null;
	locationUndecided?: boolean;
	budgetMinCents?: number | null;
	budgetMaxCents?: number | null;
	estimateFromCents?: number | null;
	estimateToCents?: number | null;
	quoteCents?: number | null;
	quoteId?: string | null;
	assigneeId?: string | null;
	source?: LeadSource | null;
	lostReason?: string | null;
	contact: {
		name?: string;
		email: string;
		phone?: string;
		instagram?: string;
		preferredContact?: string;
	};
	answers?: Record<string, string>;
	referenceKeys?: string[];
}

export interface UpdateServiceRequestInput {
	title?: string;
	stage?: ServiceRequestStage;
	preferredDate?: Date | null;
	location?: string | null;
	locationUndecided?: boolean;
	budgetMinCents?: number | null;
	budgetMaxCents?: number | null;
	estimateFromCents?: number | null;
	estimateToCents?: number | null;
	quoteCents?: number | null;
	quoteId?: string | null;
	assigneeId?: string | null;
	source?: LeadSource | null;
	lostReason?: string | null;
	contact?: {
		name?: string;
		email: string;
		phone?: string;
		instagram?: string;
		preferredContact?: string;
	};
	answers?: Record<string, string>;
	referenceKeys?: string[];
}

export async function findRequestById(id: string): Promise<ServiceRequest | null> {
	return prisma.serviceRequest.findUnique({ where: { id } });
}

export async function findRequestByReference(reference: string): Promise<ServiceRequest | null> {
	return prisma.serviceRequest.findUnique({ where: { reference } });
}

export async function listRequests(
	where: Prisma.ServiceRequestWhereInput = {},
	skip = 0,
	take = 20,
	orderBy: Prisma.ServiceRequestOrderByWithRelationInput = { updatedAt: "desc" },
): Promise<ServiceRequest[]> {
	return prisma.serviceRequest.findMany({
		where,
		skip,
		take,
		orderBy,
	});
}

export async function countRequests(where: Prisma.ServiceRequestWhereInput = {}): Promise<number> {
	return prisma.serviceRequest.count({ where });
}

export async function findClientByEmail(email: string) {
	return prisma.client.findUnique({ where: { email } });
}

export async function createClient(input: { email: string; name: string; phone?: string | null; company?: string | null; notes?: string | null; taxId?: string | null; address?: string | null; source: "WEBSITE" | "EMAIL" | "REFERRAL" | "INSTAGRAM" | "ARCHIVE"; status: "LEAD" | "ACTIVE" | "PAST" }): Promise<Client> {
	return prisma.client.create({
		data: {
			email: input.email,
			name: input.name,
			phone: input.phone ?? null,
			company: input.company ?? null,
			notes: input.notes ?? null,
			taxId: input.taxId ?? null,
			address: input.address ?? null,
			source: input.source,
			status: input.status,
			lastContactAt: new Date(),
			createdAt: new Date(),
			updatedAt: new Date(),
			clientCode: await generateNextClientCode(),
		},
	});
}

export async function createRequest(input: CreateServiceRequestInput): Promise<ServiceRequest> {
	try {
		return await prisma.serviceRequest.create({
			data: {
				reference: input.reference,
				title: input.title,
				clientId: input.clientId,
				serviceId: input.serviceId ?? null,
				stage: input.stage ?? "NEW",
				preferredDate: input.preferredDate ?? null,
				location: input.location ?? null,
				locationUndecided: input.locationUndecided ?? false,
				budgetMinCents: input.budgetMinCents ?? null,
				budgetMaxCents: input.budgetMaxCents ?? null,
				estimateFromCents: input.estimateFromCents ?? null,
				estimateToCents: input.estimateToCents ?? null,
				quoteCents: input.quoteCents ?? null,
				quoteId: input.quoteId ?? null,
				assigneeId: input.assigneeId ?? null,
				source: input.source ?? null,
				lostReason: input.lostReason ?? null,
				contact: input.contact,
				answers: input.answers ?? {},
				referenceKeys: input.referenceKeys ?? [],
			},
		});
	}
	catch (error) {
		if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
			throw new ConflictError("Request reference already exists");
		}
		throw error;
	}
}

export async function updateRequest(id: string, patch: {
	title?: string;
	stage?: "NEW" | "QUALIFIED" | "QUOTED" | "BOOKED" | "COMPLETED" | "LOST";
	preferredDate?: Date | null;
	location?: string | null;
	locationUndecided?: boolean;
	budgetMinCents?: number | null;
	budgetMaxCents?: number | null;
	estimateFromCents?: number | null;
	estimateToCents?: number | null;
	quoteCents?: number | null;
	quoteId?: string | null;
	assigneeId?: string | null;
	source?: "WEBSITE" | "EMAIL" | "REFERRAL" | "INSTAGRAM" | "ARCHIVE" | null;
	lostReason?: string | null;
	contact?: {
		name?: string;
		email: string;
		phone?: string;
		instagram?: string;
		preferredContact?: string;
	};
	answers?: Record<string, string>;
	referenceKeys?: string[];
}): Promise<ServiceRequest> {
	return prisma.serviceRequest.update({
		where: { id },
		data: {
			...(patch.title === undefined ? {} : { title: patch.title }),
			...(patch.stage === undefined ? {} : { stage: patch.stage }),
			...(patch.preferredDate === undefined ? {} : { preferredDate: patch.preferredDate }),
			...(patch.location === undefined ? {} : { location: patch.location }),
			...(patch.locationUndecided === undefined ? {} : { locationUndecided: patch.locationUndecided }),
			...(patch.budgetMinCents === undefined ? {} : { budgetMinCents: patch.budgetMinCents }),
			...(patch.budgetMaxCents === undefined ? {} : { budgetMaxCents: patch.budgetMaxCents }),
			...(patch.estimateFromCents === undefined ? {} : { estimateFromCents: patch.estimateFromCents }),
			...(patch.estimateToCents === undefined ? {} : { estimateToCents: patch.estimateToCents }),
			...(patch.quoteCents === undefined ? {} : { quoteCents: patch.quoteCents }),
			...(patch.quoteId === undefined ? {} : { quoteId: patch.quoteId }),
			...(patch.assigneeId === undefined ? {} : { assigneeId: patch.assigneeId }),
			...(patch.source === undefined ? {} : { source: patch.source }),
			...(patch.lostReason === undefined ? {} : { lostReason: patch.lostReason }),
			...(patch.contact === undefined ? {} : { contact: patch.contact }),
			...(patch.answers === undefined ? {} : { answers: patch.answers }),
			...(patch.referenceKeys === undefined ? {} : { referenceKeys: patch.referenceKeys }),
		},
	});
}

export async function addRequestNote(requestId: string, body: string, authorId: string) {
	return prisma.requestNote.create({
		data: {
			requestId,
			body,
			authorId,
		},
	});
}

export async function getRequestNotes(requestId: string) {
	return prisma.requestNote.findMany({
		where: { requestId },
		orderBy: { createdAt: "asc" },
	});
}

export async function generateNextReference(): Promise<string> {
	const year = new Date().getFullYear();
	const prefix = `REQ-${year}-`;

	const lastRequest = await prisma.serviceRequest.findFirst({
		where: { reference: { startsWith: prefix } },
		orderBy: { reference: "desc" },
		select: { reference: true },
	});

	let nextNumber = 1;

	if (lastRequest) {
		const match = lastRequest.reference.match(new RegExp(`^${prefix}(\\d+)$`));
		if (match) {
			nextNumber = parseInt(match[1], 10) + 1;
		}
	}

	return `${prefix}${nextNumber.toString().padStart(3, "0")}`;
}

export async function findClientById(id: string) {
	return prisma.client.findUnique({ where: { id } });
}

export async function findServiceBySlug(slug: string) {
	return prisma.service.findUnique({ where: { slug } });
}