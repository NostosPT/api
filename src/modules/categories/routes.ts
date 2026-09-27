import { requireAuth, requireRole } from "../../auth/context.js";
import { AuthenticationError } from "../../errors/appError.js";
import { created } from "../../http/respond.js";
import { createRouter } from "../../routing/router.js";
import { Type } from "typebox";
import {
	CreateCategoryBody,
	IdParams,
	ListCategoriesQuery,
	UpdateCategoryBody,
	type CreateCategoryBody as CreateCategoryBodyType,
	type ListCategoriesQuery as ListCategoriesQueryType,
	type UpdateCategoryBody as UpdateCategoryBodyType,
} from "./schemas.js";
import {
	createCategoryRecord,
	deleteCategoryRecord,
	getCategory,
	listAllCategories,
	moveCategoryRecord,
	updateCategoryRecord,
} from "./service.js";

function actorIdOf(request: { auth?: { user: { id: string } } }): string {
	const actorId = request.auth?.user.id;

	if (!actorId) {
		throw new AuthenticationError("Authentication required");
	}

	return actorId;
}

// Permission matrix (DECISIONS.md): categories follow the Tags row (owner
// decision) - every role reads, only ADMIN, PHOTOGRAPHER and EDITOR write.
// Roles are listed explicitly so a future role does not inherit access.
const categoryRead = [requireAuth, requireRole("ADMIN", "PHOTOGRAPHER", "EDITOR", "ASSISTANT", "ACCOUNTANT")] as const;
const categoryWrite = [requireAuth, requireRole("ADMIN", "PHOTOGRAPHER", "EDITOR")] as const;

export const router = createRouter();

router.get(
	"/",
	async (request) => {
		const query = request.query as ListCategoriesQueryType;
		const page = query.page ?? 1;
		const pageSize = query.pageSize ?? 20;

		return listAllCategories(page, pageSize, { status: query.status, q: query.q });
	},
	{ preHandler: [...categoryRead], schema: { querystring: ListCategoriesQuery } },
);

router.post(
	"/",
	async (request) => {
		const body = request.body as CreateCategoryBodyType;
		const actorId = actorIdOf(request);

		return created(await createCategoryRecord(actorId, body));
	},
	{ preHandler: [...categoryWrite], schema: { body: CreateCategoryBody } },
);

router.get(
	"/:id",
	async (request) => {
		const params = request.params as { id: string };

		return getCategory(params.id);
	},
	{ preHandler: [...categoryRead], schema: { params: IdParams } },
);

router.patch(
	"/:id",
	async (request) => {
		const params = request.params as { id: string };
		const body = request.body as UpdateCategoryBodyType;
		const actorId = actorIdOf(request);

		return updateCategoryRecord(actorId, params.id, body);
	},
	{ preHandler: [...categoryWrite], schema: { params: IdParams, body: UpdateCategoryBody } },
);

router.post(
	"/:id/move",
	async (request) => {
		const params = request.params as { id: string };
		const body = request.body as { direction: "up" | "down" };
		const actorId = actorIdOf(request);

		return moveCategoryRecord(actorId, params.id, body.direction);
	},
	{
		preHandler: [...categoryWrite],
		schema: {
			params: IdParams,
			body: Type.Object({
				direction: Type.Union([Type.Literal("up"), Type.Literal("down")]),
			}, { additionalProperties: false }),
		},
	},
);

router.delete(
	"/:id",
	async (request) => {
		const params = request.params as { id: string };
		const actorId = actorIdOf(request);

		await deleteCategoryRecord(actorId, params.id);

		return { status: "deleted" };
	},
	{ preHandler: [...categoryWrite], schema: { params: IdParams } },
);
