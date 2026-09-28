import type { CategoryStatus, Prisma } from "@prisma/client";
import { logAudit } from "../../audit/log.js";
import { ConflictError, NotFoundError } from "../../errors/appError.js";
import { toCategoryDTO, type CategoryDTO, type CategoryList } from "./dto.js";
import {
	countCategories,
	createCategory,
	deleteCategory,
	findCategoryById,
	findCategoryByName,
	findCategoryBySlug,
	listCategories,
	moveCategory,
	updateCategory,
} from "./repository.js";
import type { CreateCategoryBody, UpdateCategoryBody } from "./schemas.js";

async function getCategoryOrThrow(id: string): Promise<CategoryDTO> {
	const category = await findCategoryById(id);

	if (category === null) {
		throw new NotFoundError("Category not found");
	}

	return toCategoryDTO(category);
}

export interface CategoryFilters {
	status?: CategoryStatus;
	q?: string;
}

export async function listAllCategories(
	page: number,
	pageSize: number,
	filters: CategoryFilters = {},
): Promise<CategoryList> {
	const where: Prisma.CategoryWhereInput = {
		...(filters.status === undefined ? {} : { status: filters.status }),
		...(filters.q === undefined
			? {}
			: {
				OR: [
					{ name: { contains: filters.q, mode: "insensitive" } },
					{ slug: { contains: filters.q, mode: "insensitive" } },
				],
			}),
	};

	const [items, total] = await Promise.all([
		listCategories(where, (page - 1) * pageSize, pageSize),
		countCategories(where),
	]);

	return { items: items.map(toCategoryDTO), page, pageSize, total };
}

export async function getCategory(id: string): Promise<CategoryDTO> {
	return getCategoryOrThrow(id);
}

export async function createCategoryRecord(actorId: string, input: CreateCategoryBody): Promise<CategoryDTO> {
	const slug = input.slug.trim().toLowerCase();
	const name = input.name.trim();

	const existingSlug = await findCategoryBySlug(slug);

	if (existingSlug !== null) {
		throw new ConflictError("Category slug already exists");
	}

	const existingName = await findCategoryByName(name);

	if (existingName !== null) {
		throw new ConflictError("Category name already exists");
	}

	const category = await createCategory({
		slug,
		name,
		description: input.description?.trim() ?? null,
		...(input.status === undefined ? {} : { status: input.status }),
	});

	await logAudit({
		actorId,
		action: "categories.create",
		resourceType: "category",
		resourceId: category.id,
		result: "SUCCESS",
		metadata: { slug: category.slug, position: category.position },
	});

	return toCategoryDTO(category);
}

export async function updateCategoryRecord(
	actorId: string,
	id: string,
	patch: UpdateCategoryBody,
): Promise<CategoryDTO> {
	await getCategoryOrThrow(id);

	const name = patch.name === undefined ? undefined : patch.name.trim();

	if (name !== undefined) {
		const existingName = await findCategoryByName(name);

		if (existingName !== null && existingName.id !== id) {
			throw new ConflictError("Category name already exists");
		}
	}

	const category = await updateCategory(id, { ...patch, ...(name === undefined ? {} : { name }) });

	await logAudit({
		actorId,
		action: "categories.update",
		resourceType: "category",
		resourceId: id,
		result: "SUCCESS",
		metadata: {
			...(patch.status === undefined ? {} : { status: patch.status }),
			...(patch.name === undefined ? {} : { name: patch.name }),
		},
	});

	return toCategoryDTO(category);
}

export async function moveCategoryRecord(
	actorId: string,
	id: string,
	direction: "up" | "down",
): Promise<CategoryDTO> {
	await getCategoryOrThrow(id);

	const category = await moveCategory(id, direction);

	await logAudit({
		actorId,
		action: "categories.move",
		resourceType: "category",
		resourceId: id,
		result: "SUCCESS",
		metadata: { direction, newPosition: category.position },
	});

	return toCategoryDTO(category);
}

export async function deleteCategoryRecord(actorId: string, id: string): Promise<void> {
	await getCategoryOrThrow(id);

	await deleteCategory(id);

	await logAudit({
		actorId,
		action: "categories.delete",
		resourceType: "category",
		resourceId: id,
		result: "SUCCESS",
		metadata: null,
	});
}
