import { Prisma } from "@prisma/client";
import type { Tag, TagStatus, TagVisibility } from "@prisma/client";
import { prisma } from "../../db/prisma.js";
import { ConflictError } from "../../errors/appError.js";

export interface CreateTagInput {
	name: string;
	slug: string;
	description?: string | null;
	status?: TagStatus;
	visibility?: TagVisibility;
}

export interface UpdateTagInput {
	name?: string;
	description?: string | null;
	status?: TagStatus;
	visibility?: TagVisibility;
}

export async function findTagById(id: string): Promise<Tag | null> {
	return prisma.tag.findUnique({ where: { id } });
}

export async function findTagBySlug(slug: string): Promise<Tag | null> {
	return prisma.tag.findUnique({ where: { slug } });
}

export async function findTagByName(name: string): Promise<Tag | null> {
	return prisma.tag.findUnique({ where: { name } });
}

export async function listTags(
	where: Prisma.TagWhereInput = {},
	skip = 0,
	take = 20,
): Promise<Tag[]> {
	return prisma.tag.findMany({
		where,
		skip,
		take,
		orderBy: { name: "asc" },
	});
}

export async function countTags(where: Prisma.TagWhereInput = {}): Promise<number> {
	return prisma.tag.count({ where });
}

export async function createTag(input: CreateTagInput): Promise<Tag> {
	try {
		return await prisma.tag.create({
			data: {
				name: input.name,
				slug: input.slug,
				description: input.description ?? null,
				status: input.status ?? "ACTIVE",
				visibility: input.visibility ?? "PUBLIC",
			},
		});
	}
	catch (error) {
		if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
			throw new ConflictError("Tag already exists");
		}
		throw error;
	}
}

export async function updateTag(id: string, patch: UpdateTagInput): Promise<Tag> {
	return prisma.tag.update({
		where: { id },
		data: {
			...(patch.name === undefined ? {} : { name: patch.name }),
			...(patch.description === undefined ? {} : { description: patch.description }),
			...(patch.status === undefined ? {} : { status: patch.status }),
			...(patch.visibility === undefined ? {} : { visibility: patch.visibility }),
		},
	});
}

// Hard delete: PhotoTag/AlbumTag join rows cascade with the tag, never the
// photos or albums themselves (REQUIREMENTS §7).
export async function deleteTag(id: string): Promise<Tag> {
	return prisma.tag.delete({ where: { id } });
}
