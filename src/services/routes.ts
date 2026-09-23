import type { FastifyPluginAsyncZod, ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { prisma } from "../db/prisma.js";

const idParams = z.object({ id: z.string() });

const serviceFields = z.object({
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "lowercase-kebab-case"),
  name: z.string().min(1).max(200),
  description: z.string().max(10000).nullish(),
  priceFromCents: z.number().int().nonnegative().nullish(),
  priceToCents: z.number().int().nonnegative().nullish(),
  currency: z.string().length(3).toUpperCase().optional(),
  active: z.boolean().optional(),
  position: z.number().int().optional(),
});

const validRange = (s: { priceFromCents?: number | null; priceToCents?: number | null }) =>
  s.priceFromCents == null || s.priceToCents == null || s.priceFromCents <= s.priceToCents;
const rangeError = { message: "priceFromCents must be <= priceToCents" };

const createServiceBody = serviceFields.refine(validRange, rangeError);
const updateServiceBody = serviceFields.partial().refine(validRange, rangeError);

export const serviceRoutes: FastifyPluginAsyncZod = async (app) => {
  // Public: active services shown on the Studio page.
  app.get("/", async () => prisma.service.findMany({ where: { active: true }, orderBy: { position: "asc" } }));

  app.register(async (scope) => {
    const admin = scope.withTypeProvider<ZodTypeProvider>();
    admin.addHook("preHandler", app.requireRole("ADMIN"));

    admin.get("/all", async () => prisma.service.findMany({ orderBy: { position: "asc" } }));

    admin.post("/", { schema: { body: createServiceBody } }, async (req, reply) => {
      return reply.code(201).send(await prisma.service.create({ data: req.body }));
    });

    admin.patch("/:id", { schema: { params: idParams, body: updateServiceBody } }, async (req) => {
      return prisma.service.update({ where: { id: req.params.id }, data: req.body });
    });

    admin.delete("/:id", { schema: { params: idParams } }, async (req, reply) => {
      await prisma.service.delete({ where: { id: req.params.id } });
      return reply.code(204).send();
    });
  });
};
