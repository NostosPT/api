import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { verifyAgainstDummy, verifyPassword } from "./password.js";
import { sessionCookieOptions } from "./plugin.js";
import { SESSION_COOKIE, createSession, deleteSession } from "./sessions.js";

export const authRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    "/login",
    {
      config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
      schema: {
        body: z.object({ email: z.email().toLowerCase(), password: z.string().min(1).max(256) }),
      },
    },
    async (req, reply) => {
      const { email, password } = req.body;
      const user = await prisma.user.findUnique({ where: { email } });
      const ok = user ? await verifyPassword(user.passwordHash, password) : await verifyAgainstDummy(password);
      if (!user || !ok) throw app.httpErrors.unauthorized("Invalid email or password");

      const { token, expiresAt } = await createSession(user.id, {
        userAgent: req.headers["user-agent"],
        ip: req.ip,
      });
      reply.setCookie(SESSION_COOKIE, token, sessionCookieOptions(expiresAt));
      return { id: user.id, email: user.email, name: user.name, role: user.role };
    },
  );

  app.post("/logout", async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) await deleteSession(token);
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return reply.code(204).send();
  });

  app.get("/me", { preHandler: app.requireAuth }, async (req) => req.user);
};
