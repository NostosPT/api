import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import type { FastifyInstance } from "fastify";
import { CURRENT_API_VERSION } from "../config/api-version.js";
import type { AppConfig } from "../types/config.js";

export async function registerSwagger(app: FastifyInstance, config: AppConfig): Promise<void> {
	if (!config.env.DOCS_ENABLED) {
		return;
	}

	// Group operations by their route prefix, skipping the version segment: /v1/photos/:id → "photos".
	app.addHook("onRoute", (route) => {
		const segments = route.url.split("/").filter(Boolean);
		const tag = segments[0] === CURRENT_API_VERSION ? segments[1] : segments[0];
		if (tag && !route.schema?.tags) {
			route.schema = { ...route.schema, tags: [tag] };
		}
	});

	await app.register(swagger, {
		openapi: {
			openapi: "3.0.3",
			info: {
				title: "API",
				description: "API documentation",
				version: "1.0.0",
			},
		},
	});

	await app.register(swaggerUi, {
		routePrefix: "/docs",
	});
}