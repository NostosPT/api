import { requireAuth, requireRole } from "../../auth/context.js";
import { createRouter } from "../../routing/router.js";
import { getSystemStatus } from "./service.js";

// System health is operational detail: ADMIN only (DECISIONS.md). The
// response holds component states and sanitized codes, never hostnames,
// keys, or raw errors.
const adminOnly = [requireAuth, requireRole("ADMIN")] as const;

export const router = createRouter();

router.get(
	"/",
	async () => getSystemStatus(),
	{ preHandler: [...adminOnly] },
);
