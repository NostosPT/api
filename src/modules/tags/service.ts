import type { Prisma, TagStatus, TagVisibility } from "@prisma/client";
import { logAudit } from "../../audit/log.js";
import { ConflictError, NotFoundError } from "../../errors/appError.js";
import { toTagDTO, type TagDTO, type TagList } from "./dto.js";
import {
	countTags,
	createTag,
	deleteTag,
	findTagById,
	findTagByName,
	findTagBySlug,
	listTags,
	updateTag,
} from "./repository.js";
import type { CreateTagBody, UpdateTagBody } from "./schemas.js";

async function getTagOrThrow(id: string): Promise<TagDTO> {
	const tag = await findTagById(id);

	if (tag === null) {
		throw new NotFoundError("Tag not found");
	}

	return toTagDTO(tag);
}

export interface TagFilters {
	status?: TagStatus;
	visibility?: TagVisibility;
	q?: string;
}

export async function listAllTags(page: number, pageSize: number, filters: TagFilters = {}): Promise<TagList> {
	const where: Prisma.TagWhereInput = {
		...(filters.status === undefined ? {} : { status: filters.status }),
		...(filters.visibility === undefined ? {} : { visibility: filters.visibility }),
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
		listTags(where, (page - 1) * pageSize, pageSize),
		countTags(where),
	]);

	return { items: items.map(toTagDTO), page, pageSize, total };
}

export async function getTag(id: string): Promise<TagDTO> {
	return getTagOrThrow(id);
}

export async function createTagRecord(actorId: string, input: CreateTagBody): Promise<TagDTO> {
	const slug = input.slug.trim().toLowerCase();
	const name = input.name.trim();

	const existingSlug = await findTagBySlug(slug);

	if (existingSlug !== null) {
		throw new ConflictError("Tag slug already exists");
	}

	const existingName = await findTagByName(name);

	if (existingName !== null) {
		throw new ConflictError("Tag name already exists");
	}

	const tag = await createTag({
		slug,
		name,
		description: input.description?.trim() ?? null,
		...(input.status === undefined ? {} : { status: input.status }),
		...(input.visibility === undefined ? {} : { visibility: input.visibility }),
	});

	await logAudit({
		actorId,
		action: "tags.create",
		resourceType: "tag",
		resourceId: tag.id,
		result: "SUCCESS",
		metadata: { slug: tag.slug, visibility: tag.visibility },
	});

	return toTagDTO(tag);
}

export async function updateTagRecord(actorId: string, id: string, patch: UpdateTagBody): Promise<TagDTO> {
	await getTagOrThrow(id);

	const name = patch.name === undefined ? undefined : patch.name.trim();

	if (name !== undefined) {
		const existingName = await findTagByName(name);

		if (existingName !== null && existingName.id !== id) {
			throw new ConflictError("Tag name already exists");
		}
	}

	const tag = await updateTag(id, { ...patch, ...(name === undefined ? {} : { name }) });

	await logAudit({
		actorId,
		action: "tags.update",
		resourceType: "tag",
		resourceId: id,
		result: "SUCCESS",
		metadata: {
			...(patch.status === undefined ? {} : { status: patch.status }),
			...(patch.visibility === undefined ? {} : { visibility: patch.visibility }),
		},
	});

	return toTagDTO(tag);
}

export async function deleteTagRecord(actorId: string, id: string): Promise<void> {
	await getTagOrThrow(id);

	await deleteTag(id);

	await logAudit({
		actorId,
		action: "tags.delete",
		resourceType: "tag",
		resourceId: id,
		result: "SUCCESS",
		metadata: null,
	});
}
