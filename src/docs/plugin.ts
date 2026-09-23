import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import fp from "fastify-plugin";
import { jsonSchemaTransform, jsonSchemaTransformObject } from "fastify-type-provider-zod";
import { SESSION_COOKIE } from "../auth/sessions.js";

// The production bundle has no node_modules, so `pnpm bundle` copies Swagger UI's static
// files next to it. When running from source the plugin finds them in node_modules itself.
const bundledUiDir = fileURLToPath(new URL("./swagger-ui", import.meta.url));

// Topbar wordmark. Also keeps the plugin from reading its default logo off disk.
const logo = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="32" viewBox="0 0 160 32"><text x="0" y="23" fill="#fff" font-family="system-ui, sans-serif" font-size="20" font-weight="600" letter-spacing="3">NOSTOS API</text></svg>`;

/**
 * OpenAPI spec generated from the routes' Zod schemas, served at /docs/json and /docs/yaml,
 * with Swagger UI at /docs. The root URL redirects there. Register before any routes.
 */
export default fp(async (app) => {
  await app.register(swagger, {
    openapi: {
      openapi: "3.1.0",
      info: {
        title: "Nostos API",
        version: "1.0.0",
        description:
          "Staff endpoints use a session cookie set by `POST /auth/login`. Signing in from this page " +
          "sets it for the requests you try out here.",
      },
      tags: [
        { name: "health", description: "Liveness and readiness probes" },
        { name: "auth", description: "Staff sign-in and session" },
        { name: "archive", description: "Public photo archive (read-only)" },
        { name: "g", description: "Client galleries by share link, with an optional access code" },
        { name: "photos", description: "Photo uploads and management (staff)" },
        { name: "albums", description: "Albums (staff)" },
        { name: "galleries", description: "Client gallery management (staff)" },
        { name: "clients", description: "Clients (staff)" },
        { name: "services", description: "Services offered; editing is admin-only" },
        { name: "users", description: "Staff accounts (admin)" },
      ],
      components: {
        securitySchemes: { session: { type: "apiKey", in: "cookie", name: SESSION_COOKIE } },
      },
    },
    transform: (route) => {
      const out = jsonSchemaTransform(route);
      // A prefixed "/" route answers with or without the slash; document /photos, not /photos/.
      return { ...out, url: out.url.length > 1 ? out.url.replace(/\/$/, "") : out.url };
    },
    transformObject: jsonSchemaTransformObject,
  });

  // Group operations by their route prefix: /photos/:id → "photos".
  app.addHook("onRoute", (route) => {
    const tag = route.url.split("/")[1];
    if (tag && !route.schema?.tags) route.schema = { ...route.schema, tags: [tag] };
  });

  await app.register(swaggerUi, {
    routePrefix: "/docs",
    // Replaces helmet's policy on these routes. Swagger UI sets inline styles; scripts stay same-origin.
    staticCSP: {
      "default-src": "'self'",
      "base-uri": "'self'",
      "script-src": "'self'",
      "style-src": "'self' 'unsafe-inline'",
      "img-src": "'self' data:",
      "font-src": "'self' data:",
      "object-src": "'none'",
      "frame-ancestors": "'self'",
    },
    logo: { type: "image/svg+xml", content: logo },
    baseDir: existsSync(bundledUiDir) ? bundledUiDir : undefined,
  });

  app.get("/", { schema: { hide: true } }, (_req, reply) => reply.redirect("/docs"));
});
