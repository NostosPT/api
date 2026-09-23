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
