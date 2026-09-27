import { requireAuth, requireRole } from "../../auth/context.js";
import { AuthenticationError } from "../../errors/appError.js";
import { created } from "../../http/respond.js";
import { createRouter } from "../../routing/router.js";
import { Type } from "typebox";
import {
	CreateServiceBody,
	IdParams,
	PaginationQuery,
	UpdateServiceBody,
	type CreateServiceBody as CreateServiceBodyType,
	type UpdateServiceBody as UpdateServiceBodyType,
} from "./schemas.js";
import {
	createServiceRecord,
	deactivateServiceRecord,
	deleteServiceRecord,
	getServiceBySlug,
	listAllServices,
	moveServiceRecord,
	updateServiceRecord,
} from "./service.js";

function actorIdOf(request: { auth?: { user: { id: string } } }): string {
	const actorId = request.auth?.user.id;

	if (!actorId) {
		throw new AuthenticationError("Authentication required");
	}

	return actorId;
}

const adminOnly = [requireAuth, requireRole("ADMIN")] as const;

export const router = createRouter();

// Public catalogue: prices are marketing (DECISIONS.md item 6), and the
// public intake flow resolves requests by service slug.
router.get(
	"/",
	async () => listAllServices(true),
	{ schema: { querystring: PaginationQuery } },
);

router.get(
	"/:slug",
	async (request) => {
		const params = request.params as { slug: string };

		return getServiceBySlug(params.slug);
	},
	{ schema: { params: Type.Object({ slug: Type.String({ pattern: "^[a-z0-9-]+$", maxLength: 64 }) }) } },
);

router.post(
	"/",
	async (request) => {
		const body = request.body as CreateServiceBodyType;
		const actorId = actorIdOf(request);

		return created(await createServiceRecord(actorId, body));
	},
	{ preHandler: [...adminOnly], schema: { body: CreateServiceBody } },
);

router.patch(
	"/:id",
	async (request) => {
		const params = request.params as { id: string };
		const body = request.body as UpdateServiceBodyType;
		const actorId = actorIdOf(request);

		return updateServiceRecord(actorId, params.id, body);
	},
	{ preHandler: [...adminOnly], schema: { params: IdParams, body: UpdateServiceBody } },
);

router.post(
	"/:id/move",
	async (request) => {
		const params = request.params as { id: string };
		const body = request.body as { direction: "up" | "down" };
		const actorId = actorIdOf(request);

		return moveServiceRecord(actorId, params.id, body.direction);
	},
	{
		preHandler: [...adminOnly],
		schema: {
			params: IdParams,
			body: Type.Object({
				direction: Type.Union([Type.Literal("up"), Type.Literal("down")]),
			}, { additionalProperties: false }),
		},
	},
);

router.patch(
	"/:id/deactivate",
	async (request) => {
		const params = request.params as { id: string };
		const actorId = actorIdOf(request);

		return deactivateServiceRecord(actorId, params.id);
	},
	{ preHandler: [...adminOnly], schema: { params: IdParams } },
);

router.delete(
	"/:id",
	async (request) => {
		const params = request.params as { id: string };
		const actorId = actorIdOf(request);

		await deleteServiceRecord(actorId, params.id);

		return { status: "deleted" };
	},
	{ preHandler: [...adminOnly], schema: { params: IdParams } },
);
