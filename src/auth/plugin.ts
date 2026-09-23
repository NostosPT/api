import type { FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { env } from "../config/env.js";
import type { Role } from "../generated/prisma/enums.js";
import { SESSION_COOKIE, validateSession } from "./sessions.js";

export type AuthUser = { id: string; email: string; name: string; role: Role };

declare module "fastify" {
  interface FastifyRequest {
    user: AuthUser | null;
  }
  interface FastifyInstance {
    /** preHandler: any signed-in staff member. */
    requireAuth: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** preHandler factory: staff member with one of the given roles. */
    requireRole: (...roles: Role[]) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export function sessionCookieOptions(expires: Date) {
  return {
    path: "/",
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: "lax" as const,
    expires,
  };
}

export default fp(async (app) => {
  app.decorateRequest("user", null);

  app.addHook("onRequest", async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (!token) return;
    const session = await validateSession(token);
    if (!session) {
      reply.clearCookie(SESSION_COOKIE, { path: "/" });
      return;
    }
    req.user = session.user;
    reply.setCookie(SESSION_COOKIE, token, sessionCookieOptions(session.expiresAt));
  });

  app.decorate("requireAuth", async (req: FastifyRequest) => {
    if (!req.user) throw app.httpErrors.unauthorized();
  });

  app.decorate("requireRole", (...roles: Role[]) => async (req: FastifyRequest) => {
    if (!req.user) throw app.httpErrors.unauthorized();
    if (!roles.includes(req.user.role)) throw app.httpErrors.forbidden();
  });
});
