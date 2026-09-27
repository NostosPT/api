import { requireAuth, requireRole } from "../../auth/context.js";
import { AuthenticationError } from "../../errors/appError.js";
import { created } from "../../http/respond.js";
import { createRouter } from "../../routing/router.js";
import {
	CreateTagBody,
	IdParams,
	ListTagsQuery,
	UpdateTagBody,
	type CreateTagBody as CreateTagBodyType,
	type ListTagsQuery as ListTagsQueryType,
	type UpdateTagBody as UpdateTagBodyType,
} from "./schemas.js";
import { createTagRecord, deleteTagRecord, getTag, listAllTags, updateTagRecord } from "./service.js";

function actorIdOf(request: { auth?: { user: { id: string } } }): string {
	const actorId = request.auth?.user.id;

	if (!actorId) {
		throw new AuthenticationError("Authentication required");
	}

	return actorId;
}

// Permission matrix (DECISIONS.md): every role reads tags, only ADMIN,
// PHOTOGRAPHER and EDITOR write them. Roles are listed explicitly so a
// future role does not inherit access by default.
const tagRead = [requireAuth, requireRole("ADMIN", "PHOTOGRAPHER", "EDITOR", "ASSISTANT", "ACCOUNTANT")] as const;
const tagWrite = [requireAuth, requireRole("ADMIN", "PHOTOGRAPHER", "EDITOR")] as const;

export const router = createRouter();

router.get(
	"/",
	async (request) => {
		const query = request.query as ListTagsQueryType;
		const page = query.page ?? 1;
		const pageSize = query.pageSize ?? 20;

		return listAllTags(page, pageSize, {
			status: query.status,
			visibility: query.visibility,
			q: query.q,
		});
	},
	{ preHandler: [...tagRead], schema: { querystring: ListTagsQuery } },
);

router.post(
	"/",
	async (request) => {
		const body = request.body as CreateTagBodyType;
		const actorId = actorIdOf(request);

		return created(await createTagRecord(actorId, body));
	},
	{ preHandler: [...tagWrite], schema: { body: CreateTagBody } },
);

router.get(
	"/:id",
	async (request) => {
		const params = request.params as { id: string };

		return getTag(params.id);
	},
	{ preHandler: [...tagRead], schema: { params: IdParams } },
);

router.patch(
	"/:id",
	async (request) => {
		const params = request.params as { id: string };
		const body = request.body as UpdateTagBodyType;
		const actorId = actorIdOf(request);

		return updateTagRecord(actorId, params.id, body);
	},
	{ preHandler: [...tagWrite], schema: { params: IdParams, body: UpdateTagBody } },
);

router.delete(
	"/:id",
	async (request) => {
		const params = request.params as { id: string };
		const actorId = actorIdOf(request);

		await deleteTagRecord(actorId, params.id);

		return { status: "deleted" };
	},
	{ preHandler: [...tagWrite], schema: { params: IdParams } },
);
