import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { page, paginate, paginationQuery } from "../lib/pagination.js";

const idParams = z.object({ id: z.string() });

const clientBody = z.object({
  name: z.string().min(1).max(200),
  email: z.email().toLowerCase(),
  phone: z.string().max(40).nullish(),
  company: z.string().max(200).nullish(),
  notes: z.string().max(10000).nullish(),
});

export const clientRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook("preHandler", app.requireAuth);

  app.get("/", { schema: { querystring: paginationQuery.extend({ q: z.string().optional() }) } }, async (req) => {
    const { take, cursor, q } = req.query;
    const rows = await prisma.client.findMany({
      where: q
        ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }] }
        : {},
      orderBy: { id: "desc" },
      ...paginate({ take, cursor }),
    });
    return page(rows, take);
  });

  app.post("/", { schema: { body: clientBody } }, async (req, reply) => {
    return reply.code(201).send(await prisma.client.create({ data: req.body }));
  });

  app.get("/:id", { schema: { params: idParams } }, async (req) => {
    return prisma.client.findUniqueOrThrow({
      where: { id: req.params.id },
      include: { galleries: { select: { id: true, slug: true, title: true, status: true, createdAt: true } } },
    });
  });

  app.patch("/:id", { schema: { params: idParams, body: clientBody.partial() } }, async (req) => {
    return prisma.client.update({ where: { id: req.params.id }, data: req.body });
  });

  app.delete("/:id", { schema: { params: idParams } }, async (req, reply) => {
    await prisma.client.delete({ where: { id: req.params.id } });
    return reply.code(204).send();
  });
};
