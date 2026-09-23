import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { page, paginate, paginationQuery } from "../lib/pagination.js";
import { imageContentTypes, newOriginalKey, presignUpload, deleteObject } from "../storage/s3.js";
import { photoUrls } from "../storage/photo-urls.js";
import { createPhotoBody, photoListQuery, updatePhotoBody } from "./schemas.js";

const idParams = z.object({ id: z.string() });

/** Staff-only photo management. */
export const photoRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook("preHandler", app.requireAuth);

  // Step 1 of an upload: get a presigned PUT URL, upload the file directly to S3.
  app.post(
    "/uploads",
    { schema: { body: z.object({ contentType: z.enum(imageContentTypes) }) } },
    async (req) => {
      const key = newOriginalKey(req.body.contentType);
      return { key, uploadUrl: await presignUpload(key, req.body.contentType) };
    },
  );

  // Step 2: register the uploaded object as a photo.
  app.post("/", { schema: { body: createPhotoBody } }, async (req, reply) => {
    const photo = await prisma.photo.create({
      data: { ...req.body, photographerId: req.body.photographerId ?? req.user!.id },
    });
    return reply.code(201).send(photo);
  });

  app.get("/", { schema: { querystring: paginationQuery.extend(photoListQuery.shape) } }, async (req) => {
    const { take, cursor, category, tag, visibility } = req.query;
    const rows = await prisma.photo.findMany({
      where: { category, visibility, ...(tag && { tags: { has: tag } }) },
      orderBy: { id: "desc" },
      ...paginate({ take, cursor }),
    });
    return page(rows, take);
  });

  app.get("/:id", { schema: { params: idParams } }, async (req) => {
    const photo = await prisma.photo.findUniqueOrThrow({ where: { id: req.params.id } });
    return { ...photo, urls: await photoUrls(photo, { original: true, fallbackToOriginal: true }) };
  });

  app.patch("/:id", { schema: { params: idParams, body: updatePhotoBody } }, async (req) => {
    return prisma.photo.update({ where: { id: req.params.id }, data: req.body });
  });

  app.delete("/:id", { schema: { params: idParams } }, async (req, reply) => {
    const photo = await prisma.photo.delete({ where: { id: req.params.id } });
    const keys = [photo.originalKey, photo.displayKey, photo.thumbnailKey].filter((k): k is string => !!k);
    await Promise.allSettled(keys.map(deleteObject));
    return reply.code(204).send();
  });
};
