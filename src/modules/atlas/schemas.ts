import { Type } from "typebox";
import type { Static } from "typebox";
import {
	AtlasGeometryKindEnum,
	AtlasLocationStatusEnum,
	IdParams,
	OptionalOrNull,
	PaginationQuery,
	SlugString,
	UUID_PATTERN,
} from "../../validation/common.js";

const StrictObject = { additionalProperties: false } as const;

const UuidString = Type.String({ pattern: UUID_PATTERN });

const Latitude = Type.Number({ minimum: -90, maximum: 90 });
const Longitude = Type.Number({ minimum: -180, maximum: 180 });

// Loose GeoJSON shape (arrays only); strict ring/geometry validation lives
// in the service so failures map to ValidationError with clear messages.
const Position = Type.Array(Type.Number(), { minItems: 2, maxItems: 2 });
const LinearRing = Type.Array(Position, { minItems: 4 });
const GeoJsonPolygon = Type.Object({
	type: Type.Literal("Polygon"),
	coordinates: Type.Array(LinearRing, { minItems: 1 }),
});
const GeoJsonMultiPolygon = Type.Object({
	type: Type.Literal("MultiPolygon"),
	coordinates: Type.Array(Type.Array(LinearRing, { minItems: 1 }), { minItems: 1 }),
});
const GeoJsonArea = Type.Union([GeoJsonPolygon, GeoJsonMultiPolygon]);

const CountryCode = Type.String({ pattern: "^[A-Z]{2}$" });

// "minLng,minLat,maxLng,maxLat" for map viewport filtering.
const BboxString = Type.String({ pattern: "^-?\\d+(\\.\\d+)?,-?\\d+(\\.\\d+)?,-?\\d+(\\.\\d+)?,-?\\d+(\\.\\d+)?$" });

export const CreateLocationBody = Type.Object(
	{
		name: Type.String({ minLength: 1, maxLength: 200 }),
		slug: Type.Optional(SlugString),
		description: Type.Optional(Type.String({ maxLength: 2000 })),
		country: Type.Optional(CountryCode),
		region: Type.Optional(Type.String({ maxLength: 120 })),
		city: Type.Optional(Type.String({ maxLength: 120 })),
		geometryKind: Type.Optional(AtlasGeometryKindEnum),
		latitude: Type.Optional(Type.Union([Latitude, Type.Null()])),
		longitude: Type.Optional(Type.Union([Longitude, Type.Null()])),
		geoJson: Type.Optional(Type.Union([GeoJsonArea, Type.Null()])),
		whyInteresting: Type.Optional(Type.String({ maxLength: 2000 })),
		subjects: Type.Optional(Type.String({ maxLength: 2000 })),
		accessNotes: Type.Optional(Type.String({ maxLength: 2000 })),
		safetyNotes: Type.Optional(Type.String({ maxLength: 2000 })),
		coverPhotoId: Type.Optional(Type.Union([UuidString, Type.Null()])),
	},
	StrictObject,
);

export type CreateLocationBody = Static<typeof CreateLocationBody>;

export const UpdateLocationBody = Type.Object(
	{
		name: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
		description: OptionalOrNull(Type.String({ maxLength: 2000 })),
		country: OptionalOrNull(CountryCode),
		region: OptionalOrNull(Type.String({ maxLength: 120 })),
		city: OptionalOrNull(Type.String({ maxLength: 120 })),
		geometryKind: Type.Optional(AtlasGeometryKindEnum),
		latitude: OptionalOrNull(Latitude),
		longitude: OptionalOrNull(Longitude),
		geoJson: Type.Optional(Type.Union([GeoJsonArea, Type.Null()])),
		whyInteresting: OptionalOrNull(Type.String({ maxLength: 2000 })),
		subjects: OptionalOrNull(Type.String({ maxLength: 2000 })),
		accessNotes: OptionalOrNull(Type.String({ maxLength: 2000 })),
		safetyNotes: OptionalOrNull(Type.String({ maxLength: 2000 })),
		coverPhotoId: OptionalOrNull(UuidString),
	},
	StrictObject,
);

export type UpdateLocationBody = Static<typeof UpdateLocationBody>;

export const ListLocationsQuery = Type.Object(
	{
		...PaginationQuery.properties,
		status: Type.Optional(AtlasLocationStatusEnum),
		country: Type.Optional(CountryCode),
		category: Type.Optional(SlugString),
		q: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
		bbox: Type.Optional(BboxString),
	},
	StrictObject,
);

export type ListLocationsQuery = Static<typeof ListLocationsQuery>;

export const SetLocationPhotosBody = Type.Object(
	{
		photoIds: Type.Array(UuidString, { maxItems: 1000 }),
		captions: Type.Optional(Type.Record(Type.String(), Type.String({ maxLength: 500 }))),
	},
	StrictObject,
);

export type SetLocationPhotosBody = Static<typeof SetLocationPhotosBody>;

export const SetLocationCategoriesBody = Type.Object(
	{
		categorySlugs: Type.Array(SlugString, { minItems: 0, maxItems: 50 }),
	},
	StrictObject,
);

export type SetLocationCategoriesBody = Static<typeof SetLocationCategoriesBody>;

export { IdParams };
