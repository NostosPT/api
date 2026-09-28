import type { Service } from "@prisma/client";

export interface ServiceDTO {
	id: string;
	slug: string;
	name: string;
	description: string | null;
	priceFromCents: number | null;
	priceToCents: number | null;
	currency: string;
	active: boolean;
	position: number;
	createdAt: string;
	updatedAt: string;
}

export function toServiceDTO(service: Service): ServiceDTO {
	return {
		id: service.id,
		slug: service.slug,
		name: service.name,
		description: service.description,
		priceFromCents: service.priceFromCents,
		priceToCents: service.priceToCents,
		currency: service.currency,
		active: service.active,
		position: service.position,
		createdAt: service.createdAt.toISOString(),
		updatedAt: service.updatedAt.toISOString(),
	};
}