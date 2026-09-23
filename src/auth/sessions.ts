import { createHash, randomBytes } from "node:crypto";
import { env } from "../config/env.js";
import { prisma } from "../db/prisma.js";

export const SESSION_COOKIE = "nostos_session";

const DAY_MS = 24 * 60 * 60 * 1000;

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(userId: string, meta: { userAgent?: string; ip?: string }) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + env.SESSION_TTL_DAYS * DAY_MS);
  await prisma.session.create({
    data: { id: hashToken(token), userId, expiresAt, userAgent: meta.userAgent ?? null, ip: meta.ip ?? null },
  });
  return { token, expiresAt };
}

/** Returns the session's user, sliding the expiry forward once it is past its halfway point. */
export async function validateSession(token: string) {
  const id = hashToken(token);
  const session = await prisma.session.findUnique({
    where: { id },
    include: { user: { select: { id: true, email: true, name: true, role: true } } },
  });
  if (!session) return null;

  const now = Date.now();
  if (session.expiresAt.getTime() <= now) {
    await prisma.session.delete({ where: { id } }).catch(() => {});
    return null;
  }

  const ttl = env.SESSION_TTL_DAYS * DAY_MS;
  if (session.expiresAt.getTime() - now < ttl / 2) {
    session.expiresAt = new Date(now + ttl);
    await prisma.session.update({ where: { id }, data: { expiresAt: session.expiresAt } });
  }
  return { user: session.user, expiresAt: session.expiresAt };
}

export async function deleteSession(token: string) {
  await prisma.session.deleteMany({ where: { id: hashToken(token) } });
}

export async function deleteUserSessions(userId: string) {
  await prisma.session.deleteMany({ where: { userId } });
}
