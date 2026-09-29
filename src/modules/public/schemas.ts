import { Type } from "typebox";
import type { Static } from "typebox";
import { PaginationQuery, SlugString } from "../../validation/common.js";

const StrictObject = { additionalProperties: false } as const;

// Public endpoints are unauthenticated by design; all params use stable
// public identifiers (collection slug, photo number) — never internal ids.
export const ListPublicGalleriesQuery = Type.Object(
	{ ...PaginationQuery.properties },
	StrictObject,
);

export type ListPublicGalleriesQuery = Static<typeof ListPublicGalleriesQuery>;

export const SlugParams = Type.Object({ slug: SlugString }, StrictObject);

export type SlugParams = Static<typeof SlugParams>;

export const PhotoNumberParams = Type.Object(
	{ number: Type.Integer({ minimum: 1 }) },
	StrictObject,
);

export type PhotoNumberParams = Static<typeof PhotoNumberParams>;

const CountryCode = Type.String({ pattern: "^[A-Z]{2}$" });

// "minLng,minLat,maxLng,maxLat" for map viewport filtering.
const BboxString = Type.String({ pattern: "^-?\\d+(\\.\\d+)?,-?\\d+(\\.\\d+)?,-?\\d+(\\.\\d+)?,-?\\d+(\\.\\d+)?$" });

export const ListPublicAtlasQuery = Type.Object(
	{
		...PaginationQuery.properties,
		q: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
		country: Type.Optional(CountryCode),
		category: Type.Optional(SlugString),
		bbox: Type.Optional(BboxString),
	},
	StrictObject,
);

export type ListPublicAtlasQuery = Static<typeof ListPublicAtlasQuery>;

// "featured" narrows the listing to photos holding at least one featured
// pin in a published gallery (global ordering across collections is newest;
// per-collection editorial order lives on GalleryPhoto.position).
const publicSortLiterals = [
	Type.Literal("newest"),
	Type.Literal("oldest"),
	Type.Literal("featured"),
] as const;

export const PublicPhotoSortEnum = Type.Union([...publicSortLiterals]);

export type PublicPhotoSort = Static<typeof PublicPhotoSortEnum>;

export const ListPublicPhotosQuery = Type.Object(
	{
		...PaginationQuery.properties,
		q: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
		category: Type.Optional(SlugString),
		tag: Type.Optional(SlugString),
		gallery: Type.Optional(SlugString),
		takenFrom: Type.Optional(Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" })),
		takenTo: Type.Optional(Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" })),
		sort: Type.Optional(PublicPhotoSortEnum),
	},
	StrictObject,
);

export type ListPublicPhotosQuery = Static<typeof ListPublicPhotosQuery>;
