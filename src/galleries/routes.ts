import { randomBytes } from "node:crypto";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { hashPassword } from "../auth/password.js";
import { prisma } from "../db/prisma.js";
import { GalleryStatus } from "../generated/prisma/enums.js";

const idParams = z.object({ id: z.string() });

const galleryFields = z.object({
  title: z.string().min(1).max(200),
  message: z.string().max(5000).nullish(),
  status: z.enum(GalleryStatus).optional(),
  allowDownload: z.boolean().optional(),
  expiresAt: z.coerce.date().nullish(),
  clientId: z.string(),
  serviceId: z.string().nullish(),
  /** Plain access code to share with the client; stored hashed. `null` removes it. */
  accessCode: z.string().min(6).max(64).nullish(),
});

const newSlug = () => randomBytes(12).toString("base64url");

async function withHashedCode<T extends { accessCode?: string | null | undefined }>({ accessCode, ...rest }: T) {
  if (accessCode === undefined) return rest;
  return { ...rest, accessCodeHash: accessCode === null ? null : await hashPassword(accessCode) };
}

// Never send the hash back to the admin UI.
const omitHash = { accessCodeHash: true } as const;

/** Staff-only management of private client galleries. */
export const galleryRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook("preHandler", app.requireAuth);

  app.get("/", { schema: { querystring: z.object({ clientId: z.string().optional() }) } }, async (req) => {
    return prisma.gallery.findMany({
      where: { clientId: req.query.clientId },
      omit: omitHash,
      include: { client: { select: { id: true, name: true } }, _count: { select: { photos: true } } },
      orderBy: { createdAt: "desc" },
    });
  });

  app.post("/", { schema: { body: galleryFields } }, async (req, reply) => {
    const data = await withHashedCode(req.body);
    const gallery = await prisma.gallery.create({ data: { ...data, slug: newSlug() }, omit: omitHash });
    return reply.code(201).send(gallery);
  });

  app.get("/:id", { schema: { params: idParams } }, async (req) => {
    return prisma.gallery.findUniqueOrThrow({
      where: { id: req.params.id },
      omit: omitHash,
      include: { client: true, service: true, photos: { orderBy: { position: "asc" }, include: { photo: true } } },
    });
  });

  app.patch("/:id", { schema: { params: idParams, body: galleryFields.partial() } }, async (req) => {
    const data = await withHashedCode(req.body);
    return prisma.gallery.update({ where: { id: req.params.id }, data, omit: omitHash });
  });

  // Issue a new share link, invalidating the old one.
  app.post("/:id/rotate-link", { schema: { params: idParams } }, async (req) => {
    return prisma.gallery.update({ where: { id: req.params.id }, data: { slug: newSlug() }, select: { slug: true } });
  });

  app.delete("/:id", { schema: { params: idParams } }, async (req, reply) => {
    await prisma.gallery.delete({ where: { id: req.params.id } });
    return reply.code(204).send();
  });

  // Replaces the gallery's photos; array order becomes display order. Client selections are kept.
  app.put(
    "/:id/photos",
    { schema: { params: idParams, body: z.object({ photoIds: z.array(z.string()).max(5000) }) } },
    async (req) => {
      const galleryId = req.params.id;
      const { photoIds } = req.body;
      await prisma.$transaction([
        prisma.galleryPhoto.deleteMany({ where: { galleryId, photoId: { notIn: photoIds } } }),
        ...photoIds.map((photoId, position) =>
          prisma.galleryPhoto.upsert({
            where: { galleryId_photoId: { galleryId, photoId } },
            create: { galleryId, photoId, position },
            update: { position },
          }),
        ),
      ]);
      return { galleryId, count: photoIds.length };
    },
  );
};
