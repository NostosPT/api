import { clearSessionCookie, setSessionCookie } from "../../auth/cookies.js";
import { requireAuth } from "../../auth/context.js";
import { SESSION_COOKIE_NAME } from "../../auth/session.js";
import { config } from "../../config/index.js";
import { AuthenticationError } from "../../errors/appError.js";
import { createRouter } from "../../routing/router.js";
import {
	AcceptInviteBody,
	LoginBody,
	type AcceptInviteBody as AcceptInviteBodyType,
	type LoginBody as LoginBodyType,
} from "./schemas.js";
import {
	acceptInvite,
	currentUser,
	login,
	logout,
	logoutEverywhere,
} from "./service.js";

export const router = createRouter();

function cookieSettings() {
	return {
		secure: config.env.NODE_ENV === "production",
		maxAgeSeconds: config.env.SESSION_ABSOLUTE_SECONDS,
	};
}

function requestToken(request: { cookies?: Record<string, string | undefined> }): string {
	return request.cookies?.[SESSION_COOKIE_NAME] ?? "";
}

router.post(
	"/login",
	async (request, reply) => {
		const body = request.body as LoginBodyType;
		const result = await login(body);

		setSessionCookie(reply, result.token, cookieSettings());

		return result.user;
	},
	{
		schema: { body: LoginBody },
		config: { rateLimit: { max: 10, timeWindow: "15 minutes" } },
	},
);

router.post("/logout", async (request, reply) => {
	const auth = request.auth;

	if (!auth) {
		throw new AuthenticationError("Authentication required");
	}

	await logout(auth.user.id, requestToken(request));
	clearSessionCookie(reply, cookieSettings());

	return { status: "ok" };
}, { preHandler: [requireAuth] });

router.post("/logout-all", async (request, reply) => {
	const auth = request.auth;

	if (!auth) {
		throw new AuthenticationError("Authentication required");
	}

	const revoked = await logoutEverywhere(auth.user.id);
	clearSessionCookie(reply, cookieSettings());

	return { status: "ok", revokedSessions: revoked };
}, { preHandler: [requireAuth] });

router.get("/me", async (request) => {
	const auth = request.auth;

	if (!auth) {
		throw new AuthenticationError("Authentication required");
	}

	return currentUser(auth.user);
}, { preHandler: [requireAuth] });

router.post(
	"/accept-invite",
	async (request) => {
		const body = request.body as AcceptInviteBodyType;

		return acceptInvite(body);
	},
	{
		schema: { body: AcceptInviteBody },
		config: { rateLimit: { max: 10, timeWindow: "15 minutes" } },
	},
);
