import type { Prisma, Purchase, PurchaseScope, PurchaseStatus } from "@prisma/client";
import { prisma } from "../../db/prisma.js";

export interface CreatePurchaseInput {
	clientId: string;
	albumId: string;
	scope: PurchaseScope;
	priceCents: number;
	currency?: string;
	note?: string | null;
}

// undefined = leave unchanged, null = clear (PATCH semantics without Prisma
// FieldUpdates so the mock and Prisma behave identically).
export interface UpdatePurchaseInput {
	status?: PurchaseStatus;
	note?: string | null;
	completedAt?: Date | null;
}

export interface ListPurchasesWhere {
	clientId?: string;
	albumId?: string;
	status?: PurchaseStatus;
	scope?: PurchaseScope;
}

export async function findPurchaseById(id: string): Promise<Purchase | null> {
	return prisma.purchase.findUnique({ where: { id } });
}

export async function listPurchases(where: ListPurchasesWhere, skip: number, take: number): Promise<Purchase[]> {
	return prisma.purchase.findMany({
		where: where as Prisma.PurchaseWhereInput,
		orderBy: { createdAt: "desc" },
		skip,
		take,
	});
}

export async function countPurchases(where: ListPurchasesWhere): Promise<number> {
	return prisma.purchase.count({ where: where as Prisma.PurchaseWhereInput });
}

export async function createPurchase(input: CreatePurchaseInput): Promise<Purchase> {
	return prisma.purchase.create({
		data: {
			clientId: input.clientId,
			albumId: input.albumId,
			scope: input.scope,
			priceCents: input.priceCents,
			currency: input.currency ?? "EUR",
			note: input.note ?? null,
			// Schema default the mock does not fill itself.
			status: "PENDING",
		},
	});
}

export async function updatePurchase(id: string, input: UpdatePurchaseInput): Promise<Purchase> {
	const data: Prisma.PurchaseUncheckedUpdateInput = {};

	if (input.status !== undefined) {
		data.status = input.status;
	}
	if (input.note !== undefined) {
		data.note = input.note;
	}
	if (input.completedAt !== undefined) {
		data.completedAt = input.completedAt;
	}

	return prisma.purchase.update({ where: { id }, data });
}

export async function getPurchaseItems(purchaseId: string): Promise<{ photoId: string; addedAt: Date }[]> {
	return prisma.purchasePhoto.findMany({ where: { purchaseId }, orderBy: { addedAt: "asc" } });
}

// Immutable grant history: rows are written once (at create for PHOTO/PACK,
// at completion for ALBUM) and never updated.
export async function addPurchaseItems(purchaseId: string, photoIds: string[]): Promise<void> {
	await prisma.$transaction(async (tx) => {
		await tx.purchasePhoto.createMany({ data: photoIds.map((photoId) => ({ purchaseId, photoId })) });
	});
}
