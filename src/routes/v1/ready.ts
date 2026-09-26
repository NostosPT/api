import { createRouter } from "../../routing/router.js";
import { prisma } from "../../db/prisma.js";
import { ServiceUnavailableError } from "../../errors/appError.js";

export const router = createRouter();

// Readiness probe: verifies PostgreSQL reachability. Returns 503 (never
// internals) when the database cannot answer within the timeout.
router.get("/", async () => {
	try {
		await Promise.race([
			prisma.$queryRaw`SELECT 1`,
			new Promise((_, reject) => {
				setTimeout(() => reject(new Error("Readiness timeout")), 5_000);
			}),
		]);
	}
	catch {
		throw new ServiceUnavailableError("Database unreachable");
	}

	return { status: 200, data: { status: "ok" } };
});
