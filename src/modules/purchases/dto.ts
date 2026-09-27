import type { Purchase, PurchaseScope, PurchaseStatus } from "@prisma/client";

export interface PurchaseItemDTO {
	photoId: string;
	addedAt: string;
}

export interface PurchaseDTO {
	id: string;
	clientId: string;
	albumId: string;
	scope: PurchaseScope;
	priceCents: number;
	currency: string;
	status: PurchaseStatus;
	note: string | null;
	completedAt: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface PurchaseDetailDTO extends PurchaseDTO {
	items: PurchaseItemDTO[];
}

export function toPurchaseDTO(purchase: Purchase): PurchaseDTO {
	return {
		id: purchase.id,
		clientId: purchase.clientId,
		albumId: purchase.albumId,
		scope: purchase.scope,
		priceCents: purchase.priceCents,
		currency: purchase.currency,
		status: purchase.status,
		note: purchase.note,
		completedAt: purchase.completedAt?.toISOString() ?? null,
		createdAt: purchase.createdAt.toISOString(),
		updatedAt: purchase.updatedAt.toISOString(),
	};
}

export interface PurchaseList {
	items: PurchaseDTO[];
	page: number;
	pageSize: number;
	total: number;
}
