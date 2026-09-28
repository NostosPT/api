import type { Tag, TagStatus, TagVisibility } from "@prisma/client";

export interface TagDTO {
	id: string;
	name: string;
	slug: string;
	description: string | null;
	status: TagStatus;
	visibility: TagVisibility;
	createdAt: string;
	updatedAt: string;
}

export function toTagDTO(tag: Tag): TagDTO {
	return {
		id: tag.id,
		name: tag.name,
		slug: tag.slug,
		description: tag.description,
		status: tag.status,
		visibility: tag.visibility,
		createdAt: tag.createdAt.toISOString(),
		updatedAt: tag.updatedAt.toISOString(),
	};
}

export interface TagList {
	items: TagDTO[];
	page: number;
	pageSize: number;
	total: number;
}
