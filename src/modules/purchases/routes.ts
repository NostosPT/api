import type { Static } from "typebox";
import { requireAuth, requireRole } from "../../auth/context.js";
import { AuthenticationError } from "../../errors/appError.js";
import { created } from "../../http/respond.js";
import { createRouter } from "../../routing/router.js";
import { CreatePurchaseBody, IdParams, ListPurchasesQuery, UpdatePurchaseBody } from "./schemas.js";
import { createPurchaseRecord, getPurchase, listAllPurchases, updatePurchaseRecord } from "./service.js";

function actorIdOf(request: { auth?: { user: { id: string } } }): string {
	const actorId = request.auth?.user.id;

	if (!actorId) {
		throw new AuthenticationError("Authentication required");
	}

	return actorId;
}

// Purchases have no explicit DECISIONS.md matrix row (the frontend exposes no
// purchases UI yet). Derived from the documented rule - a role's area access
// grants CUD+P on that area's Phase 1 domains, view grants R - with purchases
// classified as CRM data (client-scoped commercial records):
// ADMIN M, PHOTOGRAPHER R, EDITOR none, ASSISTANT CUD+R, ACCOUNTANT R -
// i.e. the Clients row. This keeps ACCOUNTANT read-only in Phase 1 as
// DECISIONS.md requires. Listed explicitly so a future role does not inherit.
const purchaseRead = [requireAuth, requireRole("ADMIN", "PHOTOGRAPHER", "ASSISTANT", "ACCOUNTANT")] as const;
const purchaseWrite = [requireAuth, requireRole("ADMIN", "ASSISTANT")] as const;

export const router = createRouter();

router.get(
	"/",
	async (request) => {
		const query = request.query as Static<typeof ListPurchasesQuery>;
		const page = query.page ?? 1;
		const pageSize = query.pageSize ?? 20;

		return listAllPurchases(page, pageSize, {
			clientId: query.clientId,
			albumId: query.albumId,
			status: query.status,
			scope: query.scope,
		});
	},
	{ preHandler: [...purchaseRead], schema: { querystring: ListPurchasesQuery } },
);

router.post(
	"/",
	async (request) => {
		const body = request.body as Static<typeof CreatePurchaseBody>;
		const actorId = actorIdOf(request);

		return created(await createPurchaseRecord(actorId, body));
	},
	{ preHandler: [...purchaseWrite], schema: { body: CreatePurchaseBody } },
);

router.get(
	"/:id",
	async (request) => {
		const params = request.params as { id: string };

		return getPurchase(params.id);
	},
	{ preHandler: [...purchaseRead], schema: { params: IdParams } },
);

router.patch(
	"/:id",
	async (request) => {
		const params = request.params as { id: string };
		const body = request.body as Static<typeof UpdatePurchaseBody>;
		const actorId = actorIdOf(request);

		return updatePurchaseRecord(actorId, params.id, body);
	},
	{ preHandler: [...purchaseWrite], schema: { params: IdParams, body: UpdatePurchaseBody } },
);
