import type { Category, CategoryStatus } from "@prisma/client";

export interface CategoryDTO {
	id: string;
	name: string;
	slug: string;
	description: string | null;
	status: CategoryStatus;
	position: number;
	createdAt: string;
	updatedAt: string;
}

export function toCategoryDTO(category: Category): CategoryDTO {
	return {
		id: category.id,
		name: category.name,
		slug: category.slug,
		description: category.description,
		status: category.status,
		position: category.position,
		createdAt: category.createdAt.toISOString(),
		updatedAt: category.updatedAt.toISOString(),
	};
}

export interface CategoryList {
	items: CategoryDTO[];
	page: number;
	pageSize: number;
	total: number;
}
