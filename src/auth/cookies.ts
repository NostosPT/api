import type { FastifyReply } from "fastify";
import { config } from "../config/index.js";
import { SESSION_COOKIE_NAME, sessionCookieAttributes } from "./session.js";

export interface CookieSettings {
	secure: boolean;
	maxAgeSeconds: number;
}

// In development, __Host- prefix requires Secure which we don't have on HTTP localhost.
// Use a dev cookie name without the __Host- prefix.
function getCookieName(): string {
	return config.env.NODE_ENV === "production" ? SESSION_COOKIE_NAME : "nostos.sid";
}

// Serializes the session cookie. Clearing uses the same attributes with an
// expired value so browsers reliably drop it.
export function setSessionCookie(
	reply: FastifyReply,
	token: string,
	settings: CookieSettings,
): void {
	const attributes = sessionCookieAttributes(settings.secure, settings.maxAgeSeconds);
	const cookieName = getCookieName();

	reply.setCookie(cookieName, token, {
		httpOnly: attributes.httpOnly,
		secure: attributes.secure,
		sameSite: attributes.sameSite,
		path: attributes.path,
		maxAge: attributes.maxAgeSeconds,
	});
}

export function clearSessionCookie(reply: FastifyReply, settings: CookieSettings): void {
	const cookieName = getCookieName();

	reply.clearCookie(cookieName, {
		httpOnly: true,
		secure: settings.secure,
		sameSite: "lax",
		path: "/",
	});
}
