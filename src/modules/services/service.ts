import { logAudit } from "../../audit/log.js";
import { ConflictError, NotFoundError } from "../../errors/appError.js";
import { toServiceDTO, type ServiceDTO } from "./dto.js";
import {
	createService,
	deleteService,
	findServiceByIdOrThrow,
	findServiceBySlug,
	listServices,
	moveService,
	updateService,
} from "./repository.js";

export interface CreateServiceRequest {
	slug: string;
	name: string;
	description?: string;
	priceFromCents?: number;
	priceToCents?: number;
	currency?: string;
	active?: boolean;
}

export interface UpdateServiceRequest {
	name?: string;
	description?: string;
	priceFromCents?: number | null;
	priceToCents?: number | null;
	currency?: string;
	active?: boolean;
}

export interface ServiceList {
	items: ServiceDTO[];
}

export async function listAllServices(onlyActive = true): Promise<ServiceList> {
	const items = await listServices(onlyActive);

	return { items: items.map(toServiceDTO) };
}

export async function getServiceBySlug(slug: string): Promise<ServiceDTO> {
	const service = await findServiceBySlug(slug);

	if (service === null) {
		throw new NotFoundError("Service not found");
	}

	return toServiceDTO(service);
}

export async function getService(id: string): Promise<ServiceDTO> {
	const service = await findServiceByIdOrThrow(id);

	return toServiceDTO(service);
}

export async function createServiceRecord(actorId: string, input: CreateServiceRequest): Promise<ServiceDTO> {
	const slug = input.slug.trim().toLowerCase();

	const existing = await findServiceBySlug(slug);

	if (existing !== null) {
		throw new ConflictError("Service slug already exists");
	}

	const service = await createService({
		slug,
		name: input.name.trim(),
		description: input.description?.trim() ?? null,
		priceFromCents: input.priceFromCents,
		priceToCents: input.priceToCents,
		currency: input.currency ?? "EUR",
		active: input.active ?? true,
	});

	await logAudit({
		actorId,
		action: "services.create",
		resourceType: "service",
		resourceId: service.id,
		result: "SUCCESS",
		metadata: { slug: service.slug },
	});

	return toServiceDTO(service);
}

export async function updateServiceRecord(actorId: string, id: string, patch: UpdateServiceRequest): Promise<ServiceDTO> {
	await findServiceByIdOrThrow(id);

	const service = await updateService(id, patch);

	await logAudit({
		actorId,
		action: "services.update",
		resourceType: "service",
		resourceId: service.id,
		result: "SUCCESS",
		metadata: {
			...(patch.name === undefined ? {} : { name: patch.name }),
			...(patch.active === undefined ? {} : { active: patch.active }),
		},
	});

	return toServiceDTO(service);
}

export async function moveServiceRecord(actorId: string, id: string, direction: "up" | "down"): Promise<ServiceDTO> {
	await findServiceByIdOrThrow(id);

	const service = await moveService(id, direction);

	await logAudit({
		actorId,
		action: "services.move",
		resourceType: "service",
		resourceId: service.id,
		result: "SUCCESS",
		metadata: { direction, newPosition: service.position },
	});

	return toServiceDTO(service);
}

export async function deactivateServiceRecord(actorId: string, id: string): Promise<ServiceDTO> {
	await findServiceByIdOrThrow(id);

	const service = await updateService(id, { active: false });

	await logAudit({
		actorId,
		action: "services.deactivate",
		resourceType: "service",
		resourceId: service.id,
		result: "SUCCESS",
		metadata: null,
	});

	return toServiceDTO(service);
}

export async function deleteServiceRecord(actorId: string, id: string): Promise<void> {
	await findServiceByIdOrThrow(id);

	await deleteService(id);

	await logAudit({
		actorId,
		action: "services.delete",
		resourceType: "service",
		resourceId: id,
		result: "SUCCESS",
		metadata: null,
	});
}