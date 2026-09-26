import { TypeBoxValidatorCompiler } from "@fastify/type-provider-typebox";
import Fastify, { type FastifyInstance } from "fastify";
import { config } from "./config/index.js";
import { loadRoutes } from "./loaders/routeLoader.js";
import { redactPaths, resolveLogLevel } from "./logging/logger.js";
import { registerMiddleware } from "./middleware/index.js";

function resolveTrustProxy(value: string): boolean | string {
	if (value === "") {
		return false;
	}

	if (value === "true") {
		return true;
	}

	return value;
}

export async function createApp(): Promise<FastifyInstance> {
	const app = Fastify({
		logger: {
			level: resolveLogLevel(),
			redact: {
				paths: redactPaths,
				censor: "[Redacted]",
			},
		},

		connectionTimeout: 10_000,
		keepAliveTimeout: 72_000,
		requestTimeout: 30_000,

		routerOptions: {
			ignoreTrailingSlash: true,
			ignoreDuplicateSlashes: true,
		},

		// Conservative API limit. Photo originals bypass the API entirely via
		// direct browser → S3-compatible presigned uploads (see UPLOAD_MAX_BYTES).
		bodyLimit: 1_048_576, // 1 MB

		requestIdHeader: "x-request-id",
		trustProxy: resolveTrustProxy(config.env.TRUST_PROXY),
	});

	app.setValidatorCompiler(TypeBoxValidatorCompiler);

	await registerMiddleware(app, config);
	await loadRoutes(app);

	return app;
}
