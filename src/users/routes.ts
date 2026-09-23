import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { hashPassword } from "../auth/password.js";
import { deleteUserSessions } from "../auth/sessions.js";
import { prisma } from "../db/prisma.js";
import { Role } from "../generated/prisma/enums.js";

const idParams = z.object({ id: z.string() });
const password = z.string().min(12).max(256);
const omitHash = { passwordHash: true } as const;

/** Admin-only management of staff accounts (admins and photographers). */
export const userRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook("preHandler", app.requireRole("ADMIN"));

  app.get("/", async () => prisma.user.findMany({ omit: omitHash, orderBy: { createdAt: "asc" } }));

  app.post(
    "/",
    {
      schema: {
        body: z.object({
          email: z.email().toLowerCase(),
          name: z.string().min(1).max(200),
          password,
          role: z.enum(Role).optional(),
          bio: z.string().max(5000).nullish(),
        }),
      },
    },
    async (req, reply) => {
      const { password, ...data } = req.body;
      const user = await prisma.user.create({
        data: { ...data, passwordHash: await hashPassword(password) },
        omit: omitHash,
      });
      return reply.code(201).send(user);
    },
  );

  app.patch(
    "/:id",
    {
      schema: {
        params: idParams,
        body: z.object({
          name: z.string().min(1).max(200).optional(),
          role: z.enum(Role).optional(),
          bio: z.string().max(5000).nullish(),
          password: password.optional(),
        }),
      },
    },
    async (req) => {
      const { password, ...data } = req.body;
      const user = await prisma.user.update({
        where: { id: req.params.id },
        data: { ...data, ...(password && { passwordHash: await hashPassword(password) }) },
        omit: omitHash,
      });
      // A password or role change signs the user out everywhere.
      if (password || data.role) await deleteUserSessions(user.id);
      return user;
    },
  );

  app.delete("/:id", { schema: { params: idParams } }, async (req, reply) => {
    if (req.params.id === req.user!.id) throw app.httpErrors.badRequest("You cannot delete your own account");
    await prisma.user.delete({ where: { id: req.params.id } });
    return reply.code(204).send();
  });
};
