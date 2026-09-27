import { requireAuth, requireRole } from "../../auth/context.js";
import { AuthenticationError } from "../../errors/appError.js";
import { created } from "../../http/respond.js";
import { createRouter } from "../../routing/router.js";
import {
	CreateClientBody,
	IdParams,
	ListClientsQuery,
	PaginationQuery,
	UpdateClientBody,
	type CreateClientBody as CreateClientBodyType,
	type ListClientsQuery as ListClientsQueryType,
	type UpdateClientBody as UpdateClientBodyType,
} from "./schemas.js";
import {
	createClient,
	deleteClient,
	getClient,
	getClientActivity,
	listClients,
	updateClient,
} from "./service.js";

function actorIdOf(request: { auth?: { user: { id: string } } }): string {
	const actorId = request.auth?.user.id;

	if (!actorId) {
		throw new AuthenticationError("Authentication required");
	}

	return actorId;
}

// Permission matrix (DECISIONS.md): EDITOR has no clients access;
// PHOTOGRAPHER and ACCOUNTANT read; ADMIN and ASSISTANT create, update
// and archive. Roles are listed explicitly so a future role does not
// inherit access by default.
const clientRead = [requireAuth, requireRole("ADMIN", "PHOTOGRAPHER", "ASSISTANT", "ACCOUNTANT")] as const;
const clientWrite = [requireAuth, requireRole("ADMIN", "ASSISTANT")] as const;

export const router = createRouter();

router.get(
	"/",
	async (request) => {
		const query = request.query as ListClientsQueryType;
		const page = query.page ?? 1;
		const pageSize = query.pageSize ?? 20;

		return listClients(page, pageSize, {
			status: query.status,
			q: query.q,
			archived: query.archived,
		});
	},
	{ preHandler: [...clientRead], schema: { querystring: ListClientsQuery } },
);

router.post(
	"/",
	async (request) => {
		const body = request.body as CreateClientBodyType;
		const actorId = actorIdOf(request);

		return created(await createClient(actorId, body));
	},
	{ preHandler: [...clientWrite], schema: { body: CreateClientBody } },
);

router.get(
	"/:id",
	async (request) => {
		const params = request.params as { id: string };

		return getClient(params.id);
	},
	{ preHandler: [...clientRead], schema: { params: IdParams } },
);

router.patch(
	"/:id",
	async (request) => {
		const params = request.params as { id: string };
		const body = request.body as UpdateClientBodyType;
		const actorId = actorIdOf(request);

		return updateClient(actorId, params.id, body);
	},
	{ preHandler: [...clientWrite], schema: { params: IdParams, body: UpdateClientBody } },
);

router.delete(
	"/:id",
	async (request) => {
		const params = request.params as { id: string };
		const actorId = actorIdOf(request);

		return deleteClient(actorId, params.id);
	},
	{ preHandler: [...clientWrite], schema: { params: IdParams } },
);

router.get(
	"/:id/activity",
	async (request) => {
		const params = request.params as { id: string };
		const query = request.query as { page?: number; pageSize?: number };
		const page = query.page ?? 1;
		const pageSize = query.pageSize ?? 20;

		return getClientActivity(params.id, page, pageSize);
	},
	{ preHandler: [...clientRead], schema: { params: IdParams, querystring: PaginationQuery } },
);
