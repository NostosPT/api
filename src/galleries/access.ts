import type { FastifyReply, FastifyRequest } from "fastify";
import { env } from "../config/env.js";
import type { Gallery } from "../generated/prisma/client.js";

const ACCESS_TTL_SECONDS = 7 * 24 * 60 * 60;

const cookieName = (galleryId: string) => `nostos_gallery_${galleryId}`;

export function isGalleryOpen(gallery: Pick<Gallery, "status" | "expiresAt">) {
  return gallery.status === "PUBLISHED" && (!gallery.expiresAt || gallery.expiresAt > new Date());
}

/** After a correct access code, remember it in a signed, gallery-scoped cookie. */
export function grantGalleryAccess(reply: FastifyReply, galleryId: string) {
  reply.setCookie(cookieName(galleryId), galleryId, {
    path: "/",
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: "lax",
    signed: true,
    maxAge: ACCESS_TTL_SECONDS,
  });
}

export function hasGalleryAccess(req: FastifyRequest, gallery: Pick<Gallery, "id" | "accessCodeHash">) {
  if (req.user) return true; // staff can always preview
  if (!gallery.accessCodeHash) return true; // link-only gallery
  const raw = req.cookies[cookieName(gallery.id)];
  if (!raw) return false;
  const { valid, value } = req.unsignCookie(raw);
  return valid && value === gallery.id;
}
