import type {
	FastifyInstance,
	FastifyReply,
	FastifyRequest,
	FastifySchema,
	RouteShorthandOptions,
	preHandlerHookHandler,
} from "fastify";

import type { HttpMethod } from "../types/routes.js";

export interface RouteResult {
	status: number;
	data: unknown;
}

type RouteHandler = (
	request: FastifyRequest,
	reply: FastifyReply,
) => unknown | RouteResult | Promise<unknown | RouteResult>;

interface RouteOptions {
	schema?: FastifySchema;
	config?: RouteShorthandOptions["config"];
	preHandler?: preHandlerHookHandler | preHandlerHookHandler[];
}

interface Route extends RouteOptions {
	method: HttpMethod;
	path: string;
	handler: RouteHandler;
}

export interface Router {
	get(path: string, handler: RouteHandler, options?: RouteOptions): void;
	post(path: string, handler: RouteHandler, options?: RouteOptions): void;
	put(path: string, handler: RouteHandler, options?: RouteOptions): void;
	patch(path: string, handler: RouteHandler, options?: RouteOptions): void;
	delete(path: string, handler: RouteHandler, options?: RouteOptions): void;
	register(app: FastifyInstance, prefix: string): void;
}

export function createRouter(): Router {
	const routes: Route[] = [];

	const add = (
		method: HttpMethod,
		path: string,
		handler: RouteHandler,
		options?: RouteOptions,
	): void => {
		routes.push({
			method,
			path,
			handler,
			schema: options?.schema,
			config: options?.config,
			preHandler: options?.preHandler,
		});
	};

	return {
		get: (path, handler, options) => add("GET", path, handler, options),
		post: (path, handler, options) => add("POST", path, handler, options),
		put: (path, handler, options) => add("PUT", path, handler, options),
		patch: (path, handler, options) => add("PATCH", path, handler, options),
		delete: (path, handler, options) => add("DELETE", path, handler, options),

		register: (app, prefix) => {
			for (const route of routes) {
				const routePath =
					route.path === "/"
						? prefix
						: `${prefix}${route.path}`;

				app.route({
					method: route.method,
					url: routePath,
					schema: route.schema,
					config: route.config,
					preHandler: route.preHandler,
					handler: async (request, reply) => {
						const result = await route.handler(request, reply);

						if (
							result &&
							typeof result === "object" &&
							"status" in result &&
							"data" in result
						) {
							const { status, data } = result as RouteResult;
							return reply.status(status).send(data);
						}

						return result;
					},
				});
			}
		},
	};
}
