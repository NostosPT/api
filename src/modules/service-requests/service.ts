import type { ServiceRequest, ServiceRequestStage } from "@prisma/client";
import { logAudit } from "../../audit/log.js";
import { NotFoundError, ValidationError } from "../../errors/appError.js";
import { normalizeEmail } from "../../validation/common.js";
import { findUserById } from "../users/repository.js";
import {
	toServiceRequestDTO,
	toServiceRequestNoteDTO,
	type ServiceRequestDTO,
	type ServiceRequestList,
	type ServiceRequestNoteDTO,
	type ServiceRequestNoteList,
} from "./dto.js";
import {
	addRequestNote as insertRequestNote,
	countRequests,
	createClient,
	createRequest,
	findClientByEmail,
	findRequestById,
	findServiceBySlug,
	getRequestNotes as listRequestNotes,
	listRequests,
	updateRequest,
} from "./repository.js";
import type { CreateServiceRequestBody, UpdateServiceRequestBody } from "./schemas.js";

function parseDate(value: string, field: string): Date {
	const parsed = new Date(value);

	if (Number.isNaN(parsed.getTime())) {
		throw new ValidationError(`${field} must be a valid ISO 8601 date-time`);
	}

	return parsed;
}

async function getRequestOrThrow(id: string): Promise<ServiceRequest> {
	const request = await findRequestById(id);

	if (request === null) {
		throw new NotFoundError("Service request not found");
	}

	return request;
}

export async function createPublicServiceRequest(input: CreateServiceRequestBody): Promise<ServiceRequestDTO> {
	const service = await findServiceBySlug(input.service);

	if (service === null) {
		throw new NotFoundError("Service not found");
	}

	const email = normalizeEmail(input.contact.email);
	let client = await findClientByEmail(email);

	if (client === null) {
		client = await createClient({
			email,
			name: input.contact.name?.trim() || "New Client",
			phone: input.contact.phone ?? null,
			company: null,
			notes: null,
			taxId: null,
			address: null,
			source: "WEBSITE",
			status: "LEAD",
		});
	}

	const request = await createRequest({
		title: `${service.name} - ${input.contact.name?.trim() || "New Request"}`,
		clientId: client.id,
		serviceId: service.id,
		stage: "NEW",
		preferredDate: input.preferredDate === undefined ? null : parseDate(input.preferredDate, "preferredDate"),
		location: input.location ?? null,
		locationUndecided: input.locationUndecided ?? false,
		budgetMinCents: input.budgetMin === undefined ? null : Math.round(input.budgetMin * 100),
		budgetMaxCents: input.budgetMax === undefined ? null : Math.round(input.budgetMax * 100),
		estimateFromCents: null,
		estimateToCents: null,
		quoteCents: null,
		quoteId: null,
		assigneeId: null,
		source: "WEBSITE",
		lostReason: null,
		contact: {
			email,
			...(input.contact.name === undefined ? {} : { name: input.contact.name }),
			...(input.contact.phone === undefined ? {} : { phone: input.contact.phone }),
			...(input.contact.instagram === undefined ? {} : { instagram: input.contact.instagram }),
			...(input.contact.preferredContact === undefined ? {} : { preferredContact: input.contact.preferredContact }),
		},
		answers: input.answers ?? {},
		referenceKeys: input.referenceKeys ?? [],
	});

	return toServiceRequestDTO(request);
}

export interface ServiceRequestFilters {
	stage?: ServiceRequestStage;
	serviceId?: string;
	assigneeId?: string;
	clientId?: string;
}

export async function listServiceRequests(
	page: number,
	pageSize: number,
	filters: ServiceRequestFilters = {},
): Promise<ServiceRequestList> {
	const where = {
		...(filters.stage === undefined ? {} : { stage: filters.stage }),
		...(filters.serviceId === undefined ? {} : { serviceId: filters.serviceId }),
		...(filters.assigneeId === undefined ? {} : { assigneeId: filters.assigneeId }),
		...(filters.clientId === undefined ? {} : { clientId: filters.clientId }),
	};

	const [items, total] = await Promise.all([
		listRequests(where, (page - 1) * pageSize, pageSize),
		countRequests(where),
	]);

	return { items: items.map(toServiceRequestDTO), page, pageSize, total };
}

export async function getServiceRequest(id: string): Promise<ServiceRequestDTO> {
	return toServiceRequestDTO(await getRequestOrThrow(id));
}

export async function updateServiceRequest(
	actorId: string,
	id: string,
	patch: UpdateServiceRequestBody,
): Promise<ServiceRequestDTO> {
	await getRequestOrThrow(id);

	if (patch.stage === "LOST" && !patch.lostReason) {
		throw new ValidationError("lostReason is required when stage is LOST");
	}

	if (patch.assigneeId !== undefined && patch.assigneeId !== null) {
		const assignee = await findUserById(patch.assigneeId);

		if (assignee === null || assignee.status !== "ACTIVE") {
			throw new ValidationError("assigneeId does not reference an active user");
		}
	}

	const { preferredDate, ...rest } = patch;

	const request = await updateRequest(id, {
		...rest,
		...(preferredDate === undefined
			? {}
			: { preferredDate: preferredDate === null ? null : parseDate(preferredDate, "preferredDate") }),
	});

	await logAudit({
		actorId,
		action: "requests.update",
		resourceType: "serviceRequest",
		resourceId: id,
		result: "SUCCESS",
		metadata: {
			...(patch.stage === undefined ? {} : { stage: patch.stage }),
			...(patch.assigneeId === undefined ? {} : { assigneeId: patch.assigneeId }),
			...(patch.source === undefined ? {} : { source: patch.source }),
			...(patch.quoteCents === undefined ? {} : { quoteCents: patch.quoteCents }),
			...(patch.lostReason === undefined ? {} : { lostReason: patch.lostReason }),
		},
	});

	return toServiceRequestDTO(request);
}

export async function addRequestNote(actorId: string, requestId: string, body: string): Promise<ServiceRequestNoteDTO> {
	await getRequestOrThrow(requestId);

	const note = await insertRequestNote(requestId, body, actorId);

	await logAudit({
		actorId,
		action: "requests.note",
		resourceType: "serviceRequest",
		resourceId: requestId,
		result: "SUCCESS",
		metadata: { noteId: note.id },
	});

	return toServiceRequestNoteDTO(note);
}

export async function getRequestNotes(requestId: string): Promise<ServiceRequestNoteList> {
	await getRequestOrThrow(requestId);

	const notes = await listRequestNotes(requestId);

	return { items: notes.map(toServiceRequestNoteDTO) };
}
