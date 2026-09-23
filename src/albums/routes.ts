import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { Visibility } from "../generated/prisma/enums.js";

const idParams = z.object({ id: z.string() });
const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "lowercase-kebab-case");

const albumBody = z.object({
  slug,
  title: z.string().min(1).max(200),
  description: z.string().max(5000).nullish(),
  coverPhotoId: z.string().nullish(),
  visibility: z.enum(Visibility).optional(),
  publishedAt: z.coerce.date().nullish(),
});

/** Staff-only album management. Public reads live in the archive feature. */
export const albumRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook("preHandler", app.requireAuth);

  app.get("/", async () => prisma.album.findMany({ orderBy: { createdAt: "desc" } }));

  app.post("/", { schema: { body: albumBody } }, async (req, reply) => {
    return reply.code(201).send(await prisma.album.create({ data: req.body }));
  });

  app.get("/:id", { schema: { params: idParams } }, async (req) => {
    return prisma.album.findUniqueOrThrow({
      where: { id: req.params.id },
      include: { photos: { orderBy: { position: "asc" }, include: { photo: true } } },
    });
  });

  app.patch("/:id", { schema: { params: idParams, body: albumBody.partial() } }, async (req) => {
    return prisma.album.update({ where: { id: req.params.id }, data: req.body });
  });

  app.delete("/:id", { schema: { params: idParams } }, async (req, reply) => {
    await prisma.album.delete({ where: { id: req.params.id } });
    return reply.code(204).send();
  });

  // Replaces the album's photos; array order becomes display order.
  app.put(
    "/:id/photos",
    { schema: { params: idParams, body: z.object({ photoIds: z.array(z.string()).max(1000) }) } },
    async (req) => {
      const albumId = req.params.id;
      await prisma.$transaction([
        prisma.albumPhoto.deleteMany({ where: { albumId } }),
        prisma.albumPhoto.createMany({
          data: req.body.photoIds.map((photoId, position) => ({ albumId, photoId, position })),
        }),
      ]);
      return { albumId, count: req.body.photoIds.length };
    },
  );
};
