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

	// The swap parks the moving row on a negative position first so the
	// unique constraint never sees two rows on the same position mid-swap.
	const result = await prisma.$transaction(async function(tx) {
		await tx.category.update({ where: { id }, data: { position: -category.position } });
		await tx.category.update({ where: { id: sibling.id }, data: { position: category.position } });
		await tx.category.update({ where: { id }, data: { position: sibling.position } });
		return tx.category.findUnique({ where: { id } });
	});

	return result!;
}

// Hard delete: PhotoCategory join rows cascade with the category, never the
// photos themselves (REQUIREMENTS §7).
export async function deleteCategory(id: string): Promise<Category> {
	return prisma.category.delete({ where: { id } });
}
