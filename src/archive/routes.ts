import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { page, paginate, paginationQuery } from "../lib/pagination.js";
import { photoUrls } from "../storage/photo-urls.js";

const publicSelect = {
  id: true,
  number: true,
  title: true,
  description: true,
  width: true,
  height: true,
  takenAt: true,
  location: true,
  category: true,
  tags: true,
  availability: true,
  priceCents: true,
  currency: true,
  originalKey: true,
  displayKey: true,
  thumbnailKey: true,
  photographer: { select: { id: true, name: true } },
} as const;

async function toPublic<T extends { originalKey: string; displayKey: string | null; thumbnailKey: string | null }>(
  photo: T,
) {
  const { originalKey, displayKey, thumbnailKey, ...rest } = photo;
  const { display, thumbnail } = await photoUrls(photo, { original: false, fallbackToOriginal: false });
  return { ...rest, urls: { display, thumbnail } };
}

/** Public Archive: read-only, never exposes originals. */
export const archiveRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/photos",
    {
      schema: {
        querystring: paginationQuery.extend({ category: z.string().optional(), tag: z.string().optional() }),
      },
    },
    async (req) => {
      const { take, cursor, category, tag } = req.query;
      const rows = await prisma.photo.findMany({
        where: { visibility: "PUBLIC", category, ...(tag && { tags: { has: tag } }) },
        select: publicSelect,
        orderBy: { id: "desc" },
        ...paginate({ take, cursor }),
      });
      const { items, nextCursor } = page(rows, take);
      return { items: await Promise.all(items.map(toPublic)), nextCursor };
    },
  );

  // Lookup by Photo ID ("Nº 212" → /archive/photos/212). Unlisted photos are reachable by number.
  app.get("/photos/:number", { schema: { params: z.object({ number: z.coerce.number().int() }) } }, async (req) => {
    const photo = await prisma.photo.findFirst({
      where: { number: req.params.number, visibility: { in: ["PUBLIC", "UNLISTED"] } },
      select: publicSelect,
    });
    if (!photo) throw app.httpErrors.notFound();
    return toPublic(photo);
  });

  app.get("/categories", async () => {
    const rows = await prisma.photo.groupBy({
      by: ["category"],
      where: { visibility: "PUBLIC", category: { not: null } },
      _count: true,
      orderBy: { category: "asc" },
    });
    return rows.map((r) => ({ category: r.category, count: r._count }));
  });

  app.get("/albums", async () => {
    return prisma.album.findMany({
      where: { visibility: "PUBLIC", publishedAt: { lte: new Date() } },
      select: { id: true, slug: true, title: true, description: true, coverPhotoId: true, publishedAt: true },
      orderBy: { publishedAt: "desc" },
    });
  });

  app.get("/albums/:slug", { schema: { params: z.object({ slug: z.string() }) } }, async (req) => {
    const album = await prisma.album.findFirst({
      where: { slug: req.params.slug, visibility: { in: ["PUBLIC", "UNLISTED"] } },
      include: {
        photos: {
          where: { photo: { visibility: { not: "PRIVATE" } } },
          orderBy: { position: "asc" },
          select: { photo: { select: publicSelect } },
        },
      },
    });
    if (!album) throw app.httpErrors.notFound();
    const { photos, ...rest } = album;
    return { ...rest, photos: await Promise.all(photos.map((p) => toPublic(p.photo))) };
  });
};
