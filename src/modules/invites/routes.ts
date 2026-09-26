import { requireAuth, requireRole } from "../../auth/context.js";
import { AuthenticationError } from "../../errors/appError.js";
import { created, noContent } from "../../http/respond.js";
import { createRouter } from "../../routing/router.js";
import {
	CreateInviteBody,
	IdParams,
	PaginationQuery,
	type CreateInviteBody as CreateInviteBodyType,
	type PaginationQuery as PaginationQueryType,
} from "./schemas.js";
import { createStaffInvite, listStaffInvites, removeInvite } from "./service.js";

export const router = createRouter();

const adminOnly = [requireAuth, requireRole("ADMIN")] as const;

router.get(
	"/",
	async (request) => {
		const query = request.query as PaginationQueryType;
		const page = query.page ?? 1;
		const pageSize = query.pageSize ?? 20;

		return listStaffInvites(page, pageSize);
	},
	{ preHandler: [...adminOnly], schema: { querystring: PaginationQuery } },
);

router.post(
	"/",
	async (request) => {
		const body = request.body as CreateInviteBodyType;
		const actorId = request.auth?.user.id;

		if (!actorId) {
			throw new AuthenticationError("Authentication required");
		}

		return created(await createStaffInvite(actorId, body));
	},
	{ preHandler: [...adminOnly], schema: { body: CreateInviteBody } },
);

router.delete(
	"/:id",
	async (request) => {
		const params = request.params as { id: string };
		const actorId = request.auth?.user.id;

		if (!actorId) {
			throw new AuthenticationError("Authentication required");
		}

		await removeInvite(actorId, params.id);

		return noContent();
	},
	{ preHandler: [...adminOnly], schema: { params: IdParams } },
);
