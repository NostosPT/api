import { config } from "../../config/index.js";
import { NotFoundError, ValidationError } from "../../errors/appError.js";
import { parseBbox } from "../atlas/service.js";
import {
	findPhotoByNumberPublic,
	findPhotographerName,
	findPublicCategories,
	findPublicTags,
	listPublicPhotos as repoListPublicPhotos,
	countPublicPhotos as repoCountPublicPhotos,
	findPublishedGalleryIds,
	findMembershipPhotoIds,
	findPhotoIdsByCategorySlug,
	findPhotoIdsByTagSlug,
	findPublishedGalleries,
	findGalleryBySlugPublic,
	getPublishedGalleryEntries,
	findPhotosByIdsPublic,
	listPublishedAtlasLocations,
	countPublishedAtlasLocations,
	findAtlasBySlugPublic,
	getPublishedAtlasEntries,
	findAtlasLocationIdsByCategorySlug,
	findAtlasCategories,
	type PublicAtlasWhere,
} from "./repository.js";
import {
	toPublicGalleryDTO,
	toPublicPhotoSummary,
	type PublicAtlasCoverRef,
	type PublicAtlasLocationDetailDTO,
	type PublicAtlasLocationPage,
	type PublicAtlasPhotoRef,
	type PublicGalleryDetailDTO,
	type PublicPhotoDetailDTO,
	type PublicPhotoPage,
	type PublicGalleryPage,
} from "./dto.js";
import type { ListPublicAtlasQuery, ListPublicPhotosQuery } from "./schemas.js";

function parseDate(value: string | undefined): Date | null {
	if (!value) {
		return null;
	}

	const parsed = new Date(value);

	if (Number.isNaN(parsed.getTime())) {
		throw new ValidationError(`${value} is not a valid date`);
	}

	return parsed;
}

export async function listPublicGalleries(
	page: number,
	pageSize: number,
): Promise<PublicGalleryPage> {
	const galleries = await findPublishedGalleries();

	// Position nulls-last is not reliably handled by the mock; sort in JS for
	// parity (collections are few — negligible cost).
	galleries.sort((a, b) => {
		const pa = a.position ?? Infinity;
		const pb = b.position ?? Infinity;

		if (pa !== pb) {
			return pa - pb;
		}

		return a.createdAt.getTime() - b.createdAt.getTime();
	});

	const start = (page - 1) * pageSize;
	const items = galleries.slice(start, start + pageSize).map(toPublicGalleryDTO);

	return { items, page, pageSize, total: galleries.length };
}

export async function getPublicGallery(slug: string): Promise<PublicGalleryDetailDTO> {
	const gallery = await findGalleryBySlugPublic(slug);

	if (gallery === null) {
		throw new NotFoundError("Gallery not found");
	}

	const entries = await getPublishedGalleryEntries(gallery.id);

	if (entries.length === 0) {
		return { ...toPublicGalleryDTO(gallery), photos: [] };
	}

	const photoIds = entries.map((e) => e.photoId);
	const photos = await findPhotosByIdsPublic(photoIds);
	const photoMap = new Map(photos.map((p) => [p.id, p]));

	const publicPhotos = (
		await Promise.all(
			entries.map(async (entry) => {
				const photo = photoMap.get(entry.photoId);

				if (!photo) {
					return null;
				}

				return toPublicPhotoSummary(photo, entry.isFeatured);
			}),
		)
	).filter((p): p is NonNullable<typeof p> => p !== null);

	return { ...toPublicGalleryDTO(gallery), photos: publicPhotos };
}

// Photo.number is a PostgreSQL int4; Prisma rejects anything above this.
const MAX_PHOTO_NUMBER = 2_147_483_647;

// An all-digit search term may also be a photo number, but only when it
// fits the column — otherwise the query would fail instead of matching nothing.
function parsePhotoNumber(q: string): number | null {
	if (!/^\d+$/.test(q)) {
		return null;
	}

	const parsed = Number(q);

	return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= MAX_PHOTO_NUMBER ? parsed : null;
}

function buildPhotoWhere(query: ListPublicPhotosQuery): Omit<Parameters<typeof repoListPublicPhotos>[1], "id"> {
	const where: Record<string, unknown> = {};

	if (query.takenFrom !== undefined || query.takenTo !== undefined) {
		where.takenAt = {
			...(query.takenFrom !== undefined ? { gte: parseDate(query.takenFrom) } : {}),
			...(query.takenTo !== undefined ? { lte: parseDate(query.takenTo) } : {}),
		};
	}

	if (query.q !== undefined) {
		const q = query.q.trim();
		const number = parsePhotoNumber(q);

		where.OR = [
			{ title: { contains: q, mode: "insensitive" } },
			{ description: { contains: q, mode: "insensitive" } },
			...(number === null ? [] : [{ number }]),
		];
	}

	return where;
}

export async function listPublicPhotos(query: ListPublicPhotosQuery): Promise<PublicPhotoPage> {
	const page = query.page ?? 1;
	const pageSize = query.pageSize ?? 20;

	// 1. Candidate photos = those in any published gallery.
	const publishedGalleryIds = await findPublishedGalleryIds();
	const membership = await findMembershipPhotoIds(publishedGalleryIds);

	let candidateSet = new Set(membership.map((m) => m.photoId));

	// 2. Narrow by gallery slug (if provided).
	if (query.gallery !== undefined) {
		const gallery = await findGalleryBySlugPublic(query.gallery);

		if (gallery === null) {
			candidateSet = new Set();
		} else {
			const entries = await getPublishedGalleryEntries(gallery.id);
			candidateSet = new Set(entries.map((e) => e.photoId));
		}
	}

	// 3. Narrow by category/tag (intersect).
	if (query.category !== undefined) {
		const catIds = await findPhotoIdsByCategorySlug(query.category);
		candidateSet = new Set(catIds.filter((id) => candidateSet.has(id)));
	}

	if (query.tag !== undefined) {
		const tagIds = await findPhotoIdsByTagSlug(query.tag);
		candidateSet = new Set(tagIds.filter((id) => candidateSet.has(id)));
	}

	if (candidateSet.size === 0) {
		return { items: [], page, pageSize, total: 0 };
	}

	// 4. Featured filter: keep only photos with at least one featured pin.
	if (query.sort === "featured") {
		const featuredIds = new Set(membership.filter((m) => m.isFeatured).map((m) => m.photoId));
		candidateSet = new Set([...candidateSet].filter((id) => featuredIds.has(id)));

		if (candidateSet.size === 0) {
			return { items: [], page, pageSize, total: 0 };
		}
	}

	const where = buildPhotoWhere(query);

	// 5. Order.
	const orderBy: { createdAt: "asc" | "desc" } = query.sort === "oldest" ? { createdAt: "asc" } : { createdAt: "desc" };

	// 6. Paginate + total (repository does candidate filtering in JS for mock compatibility).
	const [photos, total] = await Promise.all([
		repoListPublicPhotos(candidateSet, where, (page - 1) * pageSize, pageSize, orderBy),
		repoCountPublicPhotos(candidateSet, where),
	]);

	return {
		items: await Promise.all(photos.map((p) => toPublicPhotoSummary(p))),
		page,
		pageSize,
		total,
	};
}

export async function getPublicPhoto(number: number): Promise<PublicPhotoDetailDTO> {
	const photo = await findPhotoByNumberPublic(number);

	if (photo === null) {
		throw new NotFoundError("Photo not found");
	}

	const [credit, categories, tags] = await Promise.all([
		photo.photographerId ? findPhotographerName(photo.photographerId) : Promise.resolve(null),
		findPublicCategories(photo.id),
		findPublicTags(photo.id),
	]);

	const copyright = config.env.SITE_COPYRIGHT ?? null;

	return {
		...(await toPublicPhotoSummary(photo)),
		description: photo.description,
		location: photo.location,
		credit,
		copyright,
		categories: categories.map((c) => ({ slug: c.slug, name: c.name })),
		tags: tags.map((t) => ({ slug: t.slug, name: t.name })),
		createdAt: photo.createdAt.toISOString(),
	};
}

type PublishedAtlasLocation = NonNullable<Awaited<ReturnType<typeof findAtlasBySlugPublic>>>;

function toPublicAtlasSummary(
	location: PublishedAtlasLocation,
	categories: { slug: string; name: string }[],
) {
	return {
		slug: location.slug,
		name: location.name,
		description: location.description,
		country: location.country,
		region: location.region,
		city: location.city,
		geometryKind: location.geometryKind,
		latitude: location.latitude,
		longitude: location.longitude,
		geoJson: (location.geoJson ?? null) as unknown,
		categories: categories.map((category) => ({ slug: category.slug, name: category.name })),
	};
}

export async function listPublicAtlasLocations(
	page: number,
	pageSize: number,
	query: ListPublicAtlasQuery,
): Promise<PublicAtlasLocationPage> {
	let candidateIds: Set<string> | null = null;

	if (query.category !== undefined) {
		candidateIds = new Set(await findAtlasLocationIdsByCategorySlug(query.category));
	}

	const bbox = query.bbox === undefined ? undefined : parseBbox(query.bbox);

	const where: PublicAtlasWhere = {
		status: "PUBLISHED",
		...(query.country === undefined ? {} : { country: query.country }),
		...(candidateIds === null ? {} : { id: { in: [...candidateIds] } }),
		...(bbox === undefined
			? {}
			: {
					latitude: { gte: bbox.minLat, lte: bbox.maxLat },
					longitude: { gte: bbox.minLng, lte: bbox.maxLng },
				}),
		...(query.q === undefined
			? {}
			: {
					OR: [
						{ name: { contains: query.q, mode: "insensitive" } },
						{ description: { contains: query.q, mode: "insensitive" } },
						{ city: { contains: query.q, mode: "insensitive" } },
						{ region: { contains: query.q, mode: "insensitive" } },
					],
				}),
	};

	const [locations, total] = await Promise.all([
		listPublishedAtlasLocations(where, (page - 1) * pageSize, pageSize),
		countPublishedAtlasLocations(where),
	]);

	const items = await Promise.all(
		locations.map(async (location) => ({
			...toPublicAtlasSummary(location, await findAtlasCategories(location.id)),
		})),
	);

	return { items, page, pageSize, total };
}

export async function getPublicAtlasLocation(slug: string): Promise<PublicAtlasLocationDetailDTO> {
	const location = await findAtlasBySlugPublic(slug);

	if (location === null) {
		throw new NotFoundError("Atlas location not found");
	}

	const [categories, entries] = await Promise.all([
		findAtlasCategories(location.id),
		getPublishedAtlasEntries(location.id),
	]);

	const photoIds = entries.map((entry) => entry.photoId);
	const photos = photoIds.length === 0 ? [] : await findPhotosByIdsPublic(photoIds);
	const photoMap = new Map(photos.map((photo) => [photo.id, photo]));

	const publicPhotos: PublicAtlasPhotoRef[] = entries
		.map((entry) => {
			const photo = photoMap.get(entry.photoId);

			if (!photo) {
				return null;
			}

			return { number: photo.number, title: photo.title, caption: entry.caption, position: entry.position };
		})
		.filter((photo): photo is NonNullable<typeof photo> => photo !== null);

	let coverPhoto: PublicAtlasCoverRef | null = null;

	if (location.coverPhotoId !== null) {
		const cover = photoMap.get(location.coverPhotoId) ?? (await findPhotosByIdsPublic([location.coverPhotoId]))[0];

		if (cover !== undefined) {
			coverPhoto = { number: cover.number, title: cover.title };
		}
	}

	return {
		...toPublicAtlasSummary(location, categories),
		whyInteresting: location.whyInteresting,
		subjects: location.subjects,
		accessNotes: location.accessNotes,
		safetyNotes: location.safetyNotes,
		coverPhoto,
		photos: publicPhotos,
	};
}