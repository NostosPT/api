import { requireAuth, requireRole } from "../../auth/context.js";
import { AuthenticationError } from "../../errors/appError.js";
import { created } from "../../http/respond.js";
import { createRouter } from "../../routing/router.js";

function actorIdOf(request: { auth?: { user: { id: string } } }): string {
	const actorId = request.auth?.user.id;

	if (!actorId) {
		throw new AuthenticationError("Authentication required");
	}

	return actorId;
}
import {
	CreateUserBody,
	IdParams,
	PaginationQuery,
	UpdateUserBody,
	type CreateUserBody as CreateUserBodyType,
	type PaginationQuery as PaginationQueryType,
	type UpdateUserBody as UpdateUserBodyType,
} from "./schemas.js";
import { deactivateUser, getUser, listAllUsers, modifyUser, registerUser } from "./service.js";

export const router = createRouter();

const adminOnly = [requireAuth, requireRole("ADMIN")] as const;

router.get(
	"/",
	async (request) => {
		const query = request.query as PaginationQueryType;
		const page = query.page ?? 1;
		const pageSize = query.pageSize ?? 20;

		return listAllUsers(page, pageSize);
	},
	{ preHandler: [...adminOnly], schema: { querystring: PaginationQuery } },
);

router.get(
	"/:id",
	async (request) => {
		const params = request.params as { id: string };

		return getUser(params.id);
	},
	{ preHandler: [...adminOnly], schema: { params: IdParams } },
);

router.post(
	"/",
	async (request) => {
		const body = request.body as CreateUserBodyType;
		const actorId = actorIdOf(request);

		return created(await registerUser(actorId, body));
	},
	{ preHandler: [...adminOnly], schema: { body: CreateUserBody } },
);

router.patch(
	"/:id",
	async (request) => {
		const params = request.params as { id: string };
		const body = request.body as UpdateUserBodyType;
		const actorId = actorIdOf(request);

		return modifyUser(actorId, params.id, body);
	},
	{ preHandler: [...adminOnly], schema: { params: IdParams, body: UpdateUserBody } },
);

router.delete(
	"/:id",
	async (request) => {
		const params = request.params as { id: string };
		const actorId = actorIdOf(request);

		return deactivateUser(actorId, params.id);
	},
	{ preHandler: [...adminOnly], schema: { params: IdParams } },
);

