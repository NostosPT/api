import type { RequestNote, ServiceRequest, ServiceRequestStage, LeadSource } from "@prisma/client";

export interface ServiceRequestDTO {
	id: string;
	reference: string;
	title: string;
	clientId: string;
	serviceId: string | null;
	stage: ServiceRequestStage;
	preferredDate: string | null;
	location: string | null;
	locationUndecided: boolean;
	budgetMinCents: number | null;
	budgetMaxCents: number | null;
	estimateFromCents: number | null;
	estimateToCents: number | null;
	quoteCents: number | null;
	quoteId: string | null;
	assigneeId: string | null;
	source: LeadSource | null;
	lostReason: string | null;
	contact: {
		name?: string;
		email: string;
		phone?: string;
		instagram?: string;
		preferredContact?: string;
	};
	answers: Record<string, string>;
	referenceKeys: string[];
	createdAt: string;
	updatedAt: string;
}

export function toServiceRequestDTO(request: ServiceRequest): ServiceRequestDTO {
	return {
		id: request.id,
		reference: request.reference,
		title: request.title,
		clientId: request.clientId,
		serviceId: request.serviceId,
		stage: request.stage,
		preferredDate: request.preferredDate?.toISOString() ?? null,
		location: request.location,
		locationUndecided: request.locationUndecided,
		budgetMinCents: request.budgetMinCents,
		budgetMaxCents: request.budgetMaxCents,
		estimateFromCents: request.estimateFromCents,
		estimateToCents: request.estimateToCents,
		quoteCents: request.quoteCents,
		quoteId: request.quoteId,
		assigneeId: request.assigneeId,
		source: request.source,
		lostReason: request.lostReason,
		contact: request.contact as ServiceRequestDTO["contact"],
		answers: request.answers as Record<string, string>,
		referenceKeys: request.referenceKeys,
		createdAt: request.createdAt.toISOString(),
		updatedAt: request.updatedAt.toISOString(),
	};
}

export interface ServiceRequestList {
	items: ServiceRequestDTO[];
	page: number;
	pageSize: number;
	total: number;
}

export interface ServiceRequestNoteDTO {
	id: string;
	body: string;
	authorId: string | null;
	createdAt: string;
}

export function toServiceRequestNoteDTO(note: RequestNote): ServiceRequestNoteDTO {
	return {
		id: note.id,
		body: note.body,
		authorId: note.authorId,
		createdAt: note.createdAt.toISOString(),
	};
}

export interface ServiceRequestNoteList {
	items: ServiceRequestNoteDTO[];
}
