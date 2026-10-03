import { Prisma } from "@prisma/client";
import type { Service } from "@prisma/client";
import { prisma } from "../../db/prisma.js";
import { ConflictError, NotFoundError, ValidationError } from "../../errors/appError.js";

export interface CreateServiceInput {
	slug: string;
	name: string;
	description?: string | null;
	priceFromCents?: number | null;
	priceToCents?: number | null;
	currency?: string;
	active?: boolean;
	position?: number;
}

export interface UpdateServiceInput {
	name?: string;
	description?: string | null;
	priceFromCents?: number | null;
	priceToCents?: number | null;
	currency?: string;
	active?: boolean;
	position?: number;
}

export async function findServiceBySlug(slug: string): Promise<Service | null> {
	return prisma.service.findUnique({ where: { slug } });
}

export async function findServiceById(id: string): Promise<Service | null> {
	return prisma.service.findUnique({ where: { id } });
}

export async function listServices(onlyActive = true): Promise<Service[]> {
	return prisma.service.findMany({
		where: onlyActive ? { active: true } : undefined,
		orderBy: { position: "asc" },
	});
}

export async function countServices(): Promise<number> {
	return prisma.service.count();
}

export async function findServiceByIdOrThrow(id: string): Promise<Service> {
	const service = await prisma.service.findUnique({ where: { id } });

	if (service === null) {
		throw new NotFoundError("Service not found");
	}

	return service;
}

export async function createService(input: CreateServiceInput): Promise<Service> {
	try {
		const maxPosition = await prisma.service.findFirst({
			orderBy: { position: "desc" },
			select: { position: true },
		});

		const position = input.position ?? (maxPosition?.position ?? 0) + 1;

		return await prisma.service.create({
			data: {
				slug: input.slug,
				name: input.name,
				description: input.description ?? null,
				priceFromCents: input.priceFromCents ?? null,
				priceToCents: input.priceToCents ?? null,
				currency: input.currency ?? "EUR",
				active: input.active ?? true,
				position,
			},
		});
	}
	catch (error) {
		if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
			throw new ConflictError("Service slug already exists");
		}
		throw error;
	}
}

export async function updateService(id: string, patch: UpdateServiceInput): Promise<Service> {
	return prisma.service.update({
		where: { id },
		data: {
			...(patch.name === undefined ? {} : { name: patch.name }),
			...(patch.description === undefined ? {} : { description: patch.description }),
			...(patch.priceFromCents === undefined ? {} : { priceFromCents: patch.priceFromCents }),
			...(patch.priceToCents === undefined ? {} : { priceToCents: patch.priceToCents }),
			...(patch.currency === undefined ? {} : { currency: patch.currency }),
			...(patch.active === undefined ? {} : { active: patch.active }),
			...(patch.position === undefined ? {} : { position: patch.position }),
		},
	});
}

export async function moveService(id: string, direction: "up" | "down"): Promise<Service> {
	const service = await prisma.service.findUnique({ where: { id } });

	if (!service) {
		throw new NotFoundError("Service not found");
	}

	// Nearest neighbour, not position ± 1: deletes leave gaps in the order.
	const sibling = await prisma.service.findFirst({
		where: { position: direction === "up" ? { gt: 0, lt: service.position } : { gt: service.position } },
		orderBy: { position: direction === "up" ? "desc" : "asc" },
	});

	if (!sibling) {
		throw new ValidationError("Cannot move service further");
	}

	// Postgres checks the non-deferrable Service_position_key index on every
	// row write, so both rows can never hold the same position mid-swap. One
	// row is parked on a negative position first (live positions start at 1),
	// the other takes its slot, then the parked row takes the other's.
	//
	// The pair is written in id order so every move takes its row locks in
	// the same global order and concurrent moves cannot deadlock. Each guarded
	// write also requires the position read above: under READ COMMITTED a
	// move that committed in between makes it match no row, and the swap
	// aborts instead of reordering from stale positions.
	const [first, second] = [service, sibling].sort((a, b) => (a.id < b.id ? -1 : 1));

	try {
		return await prisma.$transaction(async function(tx) {
			assertSwapRowUnchanged(await tx.service.updateMany({
				where: { id: first.id, position: first.position },
				data: { position: -first.position },
			}));
			assertSwapRowUnchanged(await tx.service.updateMany({
				where: { id: second.id, position: second.position },
				data: { position: first.position },
			}));
			await tx.service.update({ where: { id: first.id }, data: { position: second.position } });

			const moved = await tx.service.findUnique({ where: { id } });

			if (!moved) {
				throw new NotFoundError("Service not found");
			}

			return moved;
		});
	}
	catch (error) {
		// P2002: unique violation; P2034: deadlock or write conflict.
		if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2002" || error.code === "P2034")) {
			throw new ConflictError(SERVICE_ORDER_CHANGED);
		}
		throw error;
	}
}

const SERVICE_ORDER_CHANGED = "Service order changed, reload and try again";

function assertSwapRowUnchanged(result: { count: number }): void {
	if (result.count !== 1) {
		throw new ConflictError(SERVICE_ORDER_CHANGED);
	}
}

export async function deleteService(id: string): Promise<Service> {
	return prisma.service.delete({ where: { id } });
}