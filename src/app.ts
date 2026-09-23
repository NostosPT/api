import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import sensible from "@fastify/sensible";
import Fastify from "fastify";
import { hasZodFastifySchemaValidationErrors, serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { albumRoutes } from "./albums/routes.js";
import { archiveRoutes } from "./archive/routes.js";
import authPlugin from "./auth/plugin.js";
import { authRoutes } from "./auth/routes.js";
import { clientRoutes } from "./clients/routes.js";
import { env } from "./config/env.js";
import { clientGalleryRoutes } from "./galleries/client-routes.js";
import { galleryRoutes } from "./galleries/routes.js";
import { Prisma } from "./generated/prisma/client.js";
import { healthRoutes } from "./health/routes.js";
import { photoRoutes } from "./photos/routes.js";
import { serviceRoutes } from "./services/routes.js";
import { userRoutes } from "./users/routes.js";

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      redact: ["req.headers.cookie", "req.headers.authorization"],
    },
    trustProxy: env.TRUST_PROXY,
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(sensible);
  await app.register(helmet);
  await app.register(cors, {
    origin: env.CORS_ORIGINS.split(",").map((o) => o.trim()),
    credentials: true,
  });
  await app.register(cookie, { secret: env.COOKIE_SECRET });
  await app.register(rateLimit, { max: 300, timeWindow: "1 minute" });
  await app.register(authPlugin);

  app.setErrorHandler((err, req, reply) => {
    if (hasZodFastifySchemaValidationErrors(err)) {
      return reply.code(400).send({ statusCode: 400, error: "Bad Request", message: "Validation failed", issues: err.validation });
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === "P2025") return reply.notFound();
      if (err.code === "P2002") return reply.conflict("A record with that value already exists");
      if (err.code === "P2003") return reply.badRequest("Referenced record does not exist or is still in use");
    }
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) req.log.error(err);
    return reply.code(status).send(
      status >= 500 ? { statusCode: 500, error: "Internal Server Error", message: "Something went wrong" } : err,
    );
  });

  await app.register(healthRoutes, { prefix: "/health" });
  await app.register(authRoutes, { prefix: "/auth" });
  await app.register(userRoutes, { prefix: "/users" });
  await app.register(archiveRoutes, { prefix: "/archive" });
  await app.register(photoRoutes, { prefix: "/photos" });
  await app.register(albumRoutes, { prefix: "/albums" });
  await app.register(clientRoutes, { prefix: "/clients" });
  await app.register(serviceRoutes, { prefix: "/services" });
  await app.register(galleryRoutes, { prefix: "/galleries" });
  await app.register(clientGalleryRoutes, { prefix: "/g" });

  return app;
}
