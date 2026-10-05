import { Prisma } from "@prisma/client";
import type { Category, CategoryStatus } from "@prisma/client";
import { prisma } from "../../db/prisma.js";
import { ConflictError, NotFoundError, ValidationError } from "../../errors/appError.js";

export interface CreateCategoryInput {
	name: string;
	slug: string;
	description?: string | null;
	status?: CategoryStatus;
}

export interface UpdateCategoryInput {
	name?: string;
	description?: string | null;
	status?: CategoryStatus;
}

export async function findCategoryById(id: string): Promise<Category | null> {
	return prisma.category.findUnique({ where: { id } });
}

export async function findCategoryBySlug(slug: string): Promise<Category | null> {
	return prisma.category.findUnique({ where: { slug } });
}

export async function findCategoryByName(name: string): Promise<Category | null> {
	return prisma.category.findUnique({ where: { name } });
}

export async function listCategories(
	where: Prisma.CategoryWhereInput = {},
	skip = 0,
	take = 20,
): Promise<Category[]> {
	return prisma.category.findMany({
		where,
		skip,
		take,
		orderBy: { position: "asc" },
	});
}

export async function countCategories(where: Prisma.CategoryWhereInput = {}): Promise<number> {
	return prisma.category.count({ where });
}

export async function createCategory(input: CreateCategoryInput): Promise<Category> {
	try {
		const maxPosition = await prisma.category.findFirst({
			orderBy: { position: "desc" },
			select: { position: true },
		});

		return await prisma.category.create({
			data: {
				name: input.name,
				slug: input.slug,
				description: input.description ?? null,
				status: input.status ?? "ACTIVE",
				position: (maxPosition?.position ?? 0) + 1,
			},
		});
	}
	catch (error) {
		if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
			throw new ConflictError("Category already exists");
		}
		throw error;
	}
}

export async function updateCategory(id: string, patch: UpdateCategoryInput): Promise<Category> {
	return prisma.category.update({
		where: { id },
		data: {
			...(patch.name === undefined ? {} : { name: patch.name }),
			...(patch.description === undefined ? {} : { description: patch.description }),
			...(patch.status === undefined ? {} : { status: patch.status }),
		},
	});
}

export async function moveCategory(id: string, direction: "up" | "down"): Promise<Category> {
	const category = await prisma.category.findUnique({ where: { id } });

	if (!category) {
		throw new NotFoundError("Category not found");
	}

	// Nearest neighbour, not position ± 1: deletes leave gaps in the order.
	const sibling = await prisma.category.findFirst({
		where: { position: direction === "up" ? { gt: 0, lt: category.position } : { gt: category.position } },
		orderBy: { position: direction === "up" ? "desc" : "asc" },
	});

	if (!sibling) {
		throw new ValidationError("Cannot move category further");
	}

	// Postgres checks the non-deferrable Category_position_key index on every
	// row write, so both rows can never hold the same position mid-swap. One
	// row is parked on a negative position first (live positions start at 1),
	// the other takes its slot, then the parked row takes the other's.
	//
	// The pair is written in id order so every move takes its row locks in
	// the same global order and concurrent moves cannot deadlock. Each guarded
	// write also requires the position read above: under READ COMMITTED a
	// move that committed in between makes it match no row, and the swap
	// aborts instead of reordering from stale positions.
	const [first, second] = [category, sibling].sort((a, b) => (a.id < b.id ? -1 : 1));

	try {
		return await prisma.$transaction(async function(tx) {
			assertSwapRowUnchanged(await tx.category.updateMany({
				where: { id: first.id, position: first.position },
				data: { position: -first.position },
			}));
			assertSwapRowUnchanged(await tx.category.updateMany({
				where: { id: second.id, position: second.position },
				data: { position: first.position },
			}));
			await tx.category.update({ where: { id: first.id }, data: { position: second.position } });

			const moved = await tx.category.findUnique({ where: { id } });

			if (!moved) {
				throw new NotFoundError("Category not found");
			}

			return moved;
		});
	}
	catch (error) {
		// P2002: unique violation; P2034: deadlock or write conflict.
		if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2002" || error.code === "P2034")) {
			throw new ConflictError(CATEGORY_ORDER_CHANGED);
		}
		throw error;
	}
}

const CATEGORY_ORDER_CHANGED = "Category order changed, reload and try again";

function assertSwapRowUnchanged(result: { count: number }): void {
	if (result.count !== 1) {
		throw new ConflictError(CATEGORY_ORDER_CHANGED);
	}
}

// Hard delete: PhotoCategory join rows cascade with the category, never the
// photos themselves (REQUIREMENTS §7).
export async function deleteCategory(id: string): Promise<Category> {
	return prisma.category.delete({ where: { id } });
}
