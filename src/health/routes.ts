import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { prisma } from "../db/prisma.js";
import { checkBucket } from "../storage/s3.js";

export const healthRoutes: FastifyPluginAsyncZod = async (app) => {
  // Liveness: the process is up.
  app.get("/live", async () => ({ status: "ok" }));

  // Readiness: dependencies are reachable.
  app.get("/ready", async (_req, reply) => {
    const [db, storage] = await Promise.allSettled([prisma.$queryRaw`SELECT 1`, checkBucket()]);
    const checks = { database: db.status === "fulfilled", storage: storage.status === "fulfilled" };
    const ok = checks.database && checks.storage;
    return reply.code(ok ? 200 : 503).send({ status: ok ? "ok" : "degraded", checks });
  });
};
