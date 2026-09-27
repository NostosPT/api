import { logAudit } from "../../audit/log.js";
import { NotFoundError, ValidationError } from "../../errors/appError.js";
import { findAlbumById, getAlbumPhotoIds } from "../albums/repository.js";
import { findClientById } from "../clients/repository.js";
import { toPurchaseDTO, type PurchaseDetailDTO, type PurchaseList } from "./dto.js";
import {
	addPurchaseItems,
	countPurchases,
	createPurchase,
	findPurchaseById,
	getPurchaseItems,
	listPurchases,
	updatePurchase,
	type ListPurchasesWhere,
	type UpdatePurchaseInput,
} from "./repository.js";
import type { CreatePurchaseBody, ListPurchasesQuery, UpdatePurchaseBody } from "./schemas.js";

async function getPurchaseOrThrow(id: string) {
	const purchase = await findPurchaseById(id);

	if (purchase === null) {
		throw new NotFoundError("Purchase not found");
	}

	return purchase;
}

async function toPurchaseDetail(id: string): Promise<PurchaseDetailDTO> {
	const purchase = await getPurchaseOrThrow(id);
	const items = await getPurchaseItems(id);

	return {
		...toPurchaseDTO(purchase),
		items: items.map((item) => ({ photoId: item.photoId, addedAt: item.addedAt.toISOString() })),
	};
}

export interface PurchaseFilters {
	clientId?: string;
	albumId?: string;
	status?: ListPurchasesQuery["status"];
	scope?: ListPurchasesQuery["scope"];
}

export async function listAllPurchases(
	page: number,
	pageSize: number,
	filters: PurchaseFilters = {},
): Promise<PurchaseList> {
	const where: ListPurchasesWhere = {
		...(filters.clientId === undefined ? {} : { clientId: filters.clientId }),
		...(filters.albumId === undefined ? {} : { albumId: filters.albumId }),
		...(filters.status === undefined ? {} : { status: filters.status }),
		...(filters.scope === undefined ? {} : { scope: filters.scope }),
	};

	const [items, total] = await Promise.all([
		listPurchases(where, (page - 1) * pageSize, pageSize),
		countPurchases(where),
	]);

	return { items: items.map(toPurchaseDTO), page, pageSize, total };
}

export async function getPurchase(id: string): Promise<PurchaseDetailDTO> {
	return toPurchaseDetail(id);
}

// Scope mapping enforced app-side (schema comment): purchases are always
// album-contextual, and the album must belong to the stated client.
async function resolveScopePhotos(input: CreatePurchaseBody, albumPhotoIds: Set<string>): Promise<string[]> {
	if (input.scope === "ALBUM") {
		if (input.photoId !== undefined || input.packPhotoIds !== undefined) {
			throw new ValidationError("ALBUM purchases do not accept photo ids");
		}

		// Snapshot materializes at completion, not creation.
		return [];
	}

	if (input.scope === "PHOTO") {
		if (input.photoId === undefined) {
			throw new ValidationError("photoId is required for PHOTO purchases");
		}

		if (!albumPhotoIds.has(input.photoId)) {
			throw new ValidationError("Photo is not part of this album");
		}

		return [input.photoId];
	}

	if (input.packPhotoIds === undefined) {
		throw new ValidationError("packPhotoIds is required for PACK purchases");
	}

	// Membership implies existence: photo deletes are RESTRICTed while the
	// photo belongs to an album.
	const photoIds = [...new Set(input.packPhotoIds)];
	const missing = photoIds.filter((photoId) => !albumPhotoIds.has(photoId));

	if (missing.length > 0) {
		throw new ValidationError("One or more photos are not part of this album");
	}

	return photoIds;
}

export async function createPurchaseRecord(actorId: string, input: CreatePurchaseBody): Promise<PurchaseDetailDTO> {
	const client = await findClientById(input.clientId);

	if (client === null) {
		throw new NotFoundError("Client not found");
	}

	const album = await findAlbumById(input.albumId);

	if (album === null) {
		throw new NotFoundError("Album not found");
	}

	if (album.clientId !== input.clientId) {
		throw new ValidationError("Album does not belong to this client");
	}

	const membership = new Set(await getAlbumPhotoIds(album.id));
	const itemPhotoIds = await resolveScopePhotos(input, membership);

	const purchase = await createPurchase({
		clientId: input.clientId,
		albumId: input.albumId,
		scope: input.scope,
		priceCents: input.priceCents,
		...(input.currency === undefined ? {} : { currency: input.currency }),
		...(input.note === undefined ? {} : { note: input.note }),
	});

	// PHOTO/PACK grants are identified now and never rewritten; ALBUM snapshots
	// current membership once at completion.
	if (itemPhotoIds.length > 0) {
		await addPurchaseItems(purchase.id, itemPhotoIds);
	}

	await logAudit({
		actorId,
		action: "purchase.create",
		resourceType: "purchase",
		resourceId: purchase.id,
		result: "SUCCESS",
		metadata: {
			clientId: purchase.clientId,
			albumId: purchase.albumId,
			scope: purchase.scope,
			priceCents: purchase.priceCents,
		},
	});

	return toPurchaseDetail(purchase.id);
}

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
	PENDING: ["COMPLETED", "FAILED"],
	COMPLETED: ["REFUNDED"],
	FAILED: [],
	REFUNDED: [],
};

export async function updatePurchaseRecord(
	actorId: string,
	id: string,
	patch: UpdatePurchaseBody,
): Promise<PurchaseDetailDTO> {
	const purchase = await getPurchaseOrThrow(id);

	if (patch.status === undefined || patch.status === purchase.status) {
		if (patch.status !== undefined) {
			throw new ValidationError("Invalid purchase status transition");
		}

		if (patch.note !== undefined) {
			await updatePurchase(id, { note: patch.note });

			await logAudit({
				actorId,
				action: "purchase.update",
				resourceType: "purchase",
				resourceId: id,
				result: "SUCCESS",
				metadata: { noteChanged: true },
			});
		}

		return toPurchaseDetail(id);
	}

	const allowed = ALLOWED_TRANSITIONS[purchase.status] ?? [];

	if (!allowed.includes(patch.status)) {
		throw new ValidationError("Invalid purchase status transition");
	}

	const next: UpdatePurchaseInput = { status: patch.status };

	if (patch.status === "COMPLETED") {
		next.completedAt = new Date();

		if (purchase.scope === "ALBUM") {
			// Full-album entitlement: snapshot the membership at completion.
			const membership = await getAlbumPhotoIds(purchase.albumId);
			await addPurchaseItems(id, membership);
		}
	}

	if (patch.note !== undefined) {
		next.note = patch.note;
	}

	await updatePurchase(id, next);

	await logAudit({
		actorId,
		action: patch.status === "COMPLETED"
			? "purchase.complete"
			: patch.status === "FAILED"
				? "purchase.fail"
				: "purchase.refund",
		resourceType: "purchase",
		resourceId: id,
		result: "SUCCESS",
		metadata: { from: purchase.status, to: patch.status },
	});

	return toPurchaseDetail(id);
}
