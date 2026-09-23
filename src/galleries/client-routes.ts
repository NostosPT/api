import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { verifyPassword } from "../auth/password.js";
import { prisma } from "../db/prisma.js";
import { photoUrls } from "../storage/photo-urls.js";
import { grantGalleryAccess, hasGalleryAccess, isGalleryOpen } from "./access.js";

const slugParams = z.object({ slug: z.string() });

/** Client-facing gallery access via share link (+ optional access code). No account needed. */
export const clientGalleryRoutes: FastifyPluginAsyncZod = async (app) => {
  async function findOpenGallery(slug: string, staffPreview: boolean) {
    const gallery = await prisma.gallery.findUnique({ where: { slug } });
    if (!gallery || (!staffPreview && !isGalleryOpen(gallery))) throw app.httpErrors.notFound();
    return gallery;
  }

  app.get("/:slug", { schema: { params: slugParams } }, async (req) => {
    const g = await findOpenGallery(req.params.slug, !!req.user);
    const unlocked = hasGalleryAccess(req, g);
    return {
      title: g.title,
      requiresCode: !!g.accessCodeHash,
      unlocked,
      ...(unlocked && { message: g.message, allowDownload: g.allowDownload, expiresAt: g.expiresAt }),
    };
  });

  app.post(
    "/:slug/unlock",
    {
      config: { rateLimit: { max: 10, timeWindow: "15 minutes" } },
      schema: { params: slugParams, body: z.object({ code: z.string().min(1).max(64) }) },
    },
    async (req, reply) => {
      const g = await findOpenGallery(req.params.slug, false);
      if (!g.accessCodeHash) return { unlocked: true };
      if (!(await verifyPassword(g.accessCodeHash, req.body.code))) {
        throw app.httpErrors.unauthorized("Invalid access code");
      }
      grantGalleryAccess(reply, g.id);
      return { unlocked: true };
    },
  );

  app.get("/:slug/photos", { schema: { params: slugParams } }, async (req) => {
    const g = await findOpenGallery(req.params.slug, !!req.user);
    if (!hasGalleryAccess(req, g)) throw app.httpErrors.unauthorized("Access code required");

    const rows = await prisma.galleryPhoto.findMany({
      where: { galleryId: g.id },
      orderBy: { position: "asc" },
      include: { photo: true },
    });
    return Promise.all(
      rows.map(async ({ photo, selected }) => {
        return {
          id: photo.id,
          number: photo.number,
          title: photo.title,
          width: photo.width,
          height: photo.height,
          selected,
          urls: await photoUrls(photo, { original: g.allowDownload, fallbackToOriginal: true }),
        };
      }),
    );
  });

  // Client proofing: mark favourites.
  app.put(
    "/:slug/photos/:photoId/selection",
    { schema: { params: slugParams.extend({ photoId: z.string() }), body: z.object({ selected: z.boolean() }) } },
    async (req) => {
      const g = await findOpenGallery(req.params.slug, false);
      if (!hasGalleryAccess(req, g)) throw app.httpErrors.unauthorized("Access code required");
      const { count } = await prisma.galleryPhoto.updateMany({
        where: { galleryId: g.id, photoId: req.params.photoId },
        data: { selected: req.body.selected },
      });
      if (count === 0) throw app.httpErrors.notFound();
      return { photoId: req.params.photoId, selected: req.body.selected };
    },
  );
};
