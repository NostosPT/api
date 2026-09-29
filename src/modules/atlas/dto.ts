import type { AtlasGeometryKind, AtlasLocation, AtlasLocationStatus } from "@prisma/client";

export interface AtlasLocationDTO {
	id: string;
	slug: string;
	name: string;
	description: string | null;
	country: string | null;
	region: string | null;
	city: string | null;
	geometryKind: AtlasGeometryKind;
	latitude: number | null;
	longitude: number | null;
	geoJson: unknown;
	whyInteresting: string | null;
	subjects: string | null;
	accessNotes: string | null;
	safetyNotes: string | null;
	status: AtlasLocationStatus;
	coverPhotoId: string | null;
	authorId: string | null;
	publishedAt: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface AtlasLocationCategoryRef {
	categoryId: string;
	slug: string;
	name: string;
}

export interface AtlasLocationPhotoRef {
	photoId: string;
	caption: string | null;
	position: number;
}

export interface AtlasLocationDetailDTO extends AtlasLocationDTO {
	categories: AtlasLocationCategoryRef[];
	photos: AtlasLocationPhotoRef[];
}

export interface AtlasLocationList {
	items: AtlasLocationDTO[];
	page: number;
	pageSize: number;
	total: number;
}

export function toAtlasLocationDTO(location: AtlasLocation): AtlasLocationDTO {
	return {
		id: location.id,
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
		whyInteresting: location.whyInteresting,
		subjects: location.subjects,
		accessNotes: location.accessNotes,
		safetyNotes: location.safetyNotes,
		status: location.status,
		coverPhotoId: location.coverPhotoId,
		authorId: location.authorId,
		publishedAt: location.publishedAt?.toISOString() ?? null,
		createdAt: location.createdAt.toISOString(),
		updatedAt: location.updatedAt.toISOString(),
	};
}
