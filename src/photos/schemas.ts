import { z } from "zod";
import { Availability, Visibility } from "../generated/prisma/enums.js";

export const photoMetadata = z.object({
  title: z.string().max(200).nullish(),
  description: z.string().max(5000).nullish(),
  width: z.number().int().positive().nullish(),
  height: z.number().int().positive().nullish(),
  takenAt: z.coerce.date().nullish(),
  location: z.string().max(200).nullish(),
  category: z.string().max(60).nullish(),
  tags: z.array(z.string().max(60)).max(50).optional(),
  visibility: z.enum(Visibility).optional(),
  availability: z.enum(Availability).optional(),
  priceCents: z.number().int().nonnegative().nullish(),
  currency: z.string().length(3).toUpperCase().optional(),
  watermarked: z.boolean().optional(),
  photographerId: z.string().nullish(),
  displayKey: z.string().nullish(),
  thumbnailKey: z.string().nullish(),
});

export const createPhotoBody = photoMetadata.extend({
  originalKey: z.string().startsWith("originals/"),
});

export const updatePhotoBody = photoMetadata;

export const photoListQuery = z.object({
  category: z.string().optional(),
  tag: z.string().optional(),
  visibility: z.enum(Visibility).optional(),
});

/** A photo as stored. Shows up as the `Photo` component in the OpenAPI spec. */
export const photoResponse = z
  .object({
    id: z.string(),
    number: z.number().int(),
    title: z.string().nullable(),
    description: z.string().nullable(),
    originalKey: z.string(),
    displayKey: z.string().nullable(),
    thumbnailKey: z.string().nullable(),
    width: z.number().int().nullable(),
    height: z.number().int().nullable(),
    takenAt: z.date().nullable(),
    location: z.string().nullable(),
    category: z.string().nullable(),
    tags: z.array(z.string()),
    visibility: z.enum(Visibility),
    availability: z.enum(Availability),
    priceCents: z.number().int().nullable(),
    currency: z.string(),
    watermarked: z.boolean(),
    photographerId: z.string().nullable(),
    createdAt: z.date(),
    updatedAt: z.date(),
  })
  .meta({ id: "Photo" });

/** Adds short-lived presigned URLs, null when that rendition isn't available. */
export const photoWithUrlsResponse = photoResponse.extend({
  urls: z.object({
    display: z.string().nullable(),
    thumbnail: z.string().nullable(),
    original: z.string().nullable(),
  }),
});
