import { createRouter } from "../../routing/router.js";
import { prisma } from "../../db/prisma.js";
import { ServiceUnavailableError } from "../../errors/appError.js";
import { storage } from "../../storage/index.js";

export const router = createRouter();

const READY_TIMEOUT_MS = 5_000;

// Readiness probe: verifies PostgreSQL and storage reachability. Returns 503
// (never internals) when either cannot answer within the timeout. Storage
// that is not configured (development without S3) does not fail readiness.
router.get("/", async () => {
	try {
		await Promise.race([
			prisma.$queryRaw`SELECT 1`,
			new Promise((_, reject) => {
				setTimeout(() => reject(new Error("Readiness timeout")), READY_TIMEOUT_MS);
			}),
		]);
	}
	catch {
		throw new ServiceUnavailableError("Database unreachable");
	}

	const storageResult = await storage.ping(READY_TIMEOUT_MS);

	if (storageResult !== null && !storageResult.ok) {
		throw new ServiceUnavailableError("Storage unreachable");
	}

	return { status: 200, data: { status: "ok" } };
});
