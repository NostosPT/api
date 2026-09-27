import { requireAuth, requireRole } from "../../auth/context.js";
import { AuthenticationError } from "../../errors/appError.js";
import { created } from "../../http/respond.js";
import { createRouter } from "../../routing/router.js";
import {
	AddNoteBody,
	CreateServiceRequestBody,
	IdParams,
	ListServiceRequestsQuery,
	UpdateServiceRequestBody,
	type AddNoteBody as AddNoteBodyType,
	type CreateServiceRequestBody as CreateServiceRequestBodyType,
	type ListServiceRequestsQuery as ListServiceRequestsQueryType,
	type UpdateServiceRequestBody as UpdateServiceRequestBodyType,
} from "./schemas.js";
import {
	addRequestNote,
	createPublicServiceRequest,
	getRequestNotes,
	getServiceRequest,
	listServiceRequests,
	updateServiceRequest,
} from "./service.js";

function actorIdOf(request: { auth?: { user: { id: string } } }): string {
	const actorId = request.auth?.user.id;

	if (!actorId) {
		throw new AuthenticationError("Authentication required");
	}

	return actorId;
}

// Permission matrix (DECISIONS.md): every role reads requests, only
// ADMIN and ASSISTANT write them. Roles are listed explicitly so a future
// role does not inherit access by default.
const requestRead = [requireAuth, requireRole("ADMIN", "PHOTOGRAPHER", "EDITOR", "ASSISTANT", "ACCOUNTANT")] as const;
const requestWrite = [requireAuth, requireRole("ADMIN", "ASSISTANT")] as const;

export const router = createRouter();

router.post(
	"/",
	async (request) => {
		const body = request.body as CreateServiceRequestBodyType;

		return created(await createPublicServiceRequest(body));
	},
	{ schema: { body: CreateServiceRequestBody } },
);

router.get(
	"/",
	async (request) => {
		const query = request.query as ListServiceRequestsQueryType;
		const page = query.page ?? 1;
		const pageSize = query.pageSize ?? 20;

		return listServiceRequests(page, pageSize, {
			stage: query.stage,
			serviceId: query.serviceId,
			assigneeId: query.assigneeId,
			clientId: query.clientId,
		});
	},
	{ preHandler: [...requestRead], schema: { querystring: ListServiceRequestsQuery } },
);

router.get(
	"/:id",
	async (request) => {
		const params = request.params as { id: string };

		return getServiceRequest(params.id);
	},
	{ preHandler: [...requestRead], schema: { params: IdParams } },
);

router.patch(
	"/:id",
	async (request) => {
		const params = request.params as { id: string };
		const body = request.body as UpdateServiceRequestBodyType;
		const actorId = actorIdOf(request);

		return updateServiceRequest(actorId, params.id, body);
	},
	{ preHandler: [...requestWrite], schema: { params: IdParams, body: UpdateServiceRequestBody } },
);

router.post(
	"/:id/notes",
	async (request) => {
		const params = request.params as { id: string };
		const body = request.body as AddNoteBodyType;
		const actorId = actorIdOf(request);

		return created(await addRequestNote(actorId, params.id, body.body));
	},
	{ preHandler: [...requestWrite], schema: { params: IdParams, body: AddNoteBody } },
);

router.get(
	"/:id/notes",
	async (request) => {
		const params = request.params as { id: string };

		return getRequestNotes(params.id);
	},
	{ preHandler: [...requestRead], schema: { params: IdParams } },
);
