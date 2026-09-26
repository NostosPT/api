import cookie from "@fastify/cookie";
import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../types/config.js";

export async function registerCookies(app: FastifyInstance, config: AppConfig): Promise<void> {
	await app.register(cookie, {
		secret: config.env.COOKIE_SECRET,
	});
}
