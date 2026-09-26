import type { FastifyReply } from "fastify";
import { SESSION_COOKIE_NAME, sessionCookieAttributes } from "./session.js";

export interface CookieSettings {
	secure: boolean;
	maxAgeSeconds: number;
}

// Serializes the session cookie. Clearing uses the same attributes with an
// expired value so browsers reliably drop it.
export function setSessionCookie(
	reply: FastifyReply,
	token: string,
	settings: CookieSettings,
): void {
	const attributes = sessionCookieAttributes(settings.secure, settings.maxAgeSeconds);

	reply.setCookie(SESSION_COOKIE_NAME, token, {
		httpOnly: attributes.httpOnly,
		secure: attributes.secure,
		sameSite: attributes.sameSite,
		path: attributes.path,
		maxAge: attributes.maxAgeSeconds,
	});
}

export function clearSessionCookie(reply: FastifyReply, settings: CookieSettings): void {
	reply.clearCookie(SESSION_COOKIE_NAME, {
		httpOnly: true,
		secure: settings.secure,
		sameSite: "lax",
		path: "/",
	});
}
