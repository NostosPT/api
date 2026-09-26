import { createRouter } from "../../routing/router.js";

export const router = createRouter();

// Liveness probe for infrastructure checks. No details, no dependencies.
router.get("/", async () => {
	return { status: "ok" };
});
