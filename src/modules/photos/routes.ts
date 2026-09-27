import type { Static } from "typebox";
import { requireAuth, requireRole } from "../../auth/context.js";
import type { AuthenticatedUser } from "../../auth/session.js";
import { AuthenticationError } from "../../errors/appError.js";
import { created } from "../../http/respond.js";
import { createRouter } from "../../routing/router.js";
import {
	CreatePhotoBody,
	CreateUploadBody,
	IdParams,
	ListPhotosQuery,
	UpdatePhotoBody,
} from "./schemas.js";
import {
	createUploadIntent,
	deletePhotoRecord,
	getPhoto,
	listAllPhotos,
	publishPhoto,
	registerPhoto,
	unpublishPhoto,
	updatePhotoRecord,
} from "./service.js";

function actorOf(request: { auth?: { user: AuthenticatedUser } }): AuthenticatedUser {
	const user = request.auth?.user;

	if (!user) {
		throw new AuthenticationError("Authentication required");
	}

	return user;
}

// Permission matrix (DECISIONS.md): every staff role except ACCOUNTANT reads
// photos; PHOTOGRAPHER additionally acts on their own photos only (owner
// decision, enforced in the service). Roles are listed explicitly so a future
// role does not inherit access.
const photoRead = [requireAuth, requireRole("ADMIN", "PHOTOGRAPHER", "EDITOR", "ASSISTANT")] as const;
const photoWrite = [requireAuth, requireRole("ADMIN", "PHOTOGRAPHER", "EDITOR")] as const;

export const router = createRouter();

router.get(
	"/",
	async (request) => {
		const query = request.query as Static<typeof ListPhotosQuery>;
		const actor = actorOf(request);
		const page = query.page ?? 1;
		const pageSize = query.pageSize ?? 20;

		return listAllPhotos(actor, page, pageSize, {
			status: query.status,
			visibility: query.visibility,
			availability: query.availability,
			uploadStatus: query.uploadStatus,
			photographerId: query.photographerId,
			q: query.q,
		});
	},
	{ preHandler: [...photoRead], schema: { querystring: ListPhotosQuery } },
);

router.post(
	"/uploads",
	async (request) => {
		const body = request.body as Static<typeof CreateUploadBody>;
		const actor = actorOf(request);

		return created(await createUploadIntent(actor, body));
	},
	{ preHandler: [...photoWrite], schema: { body: CreateUploadBody } },
);

router.post(
	"/",
	async (request) => {
		const body = request.body as Static<typeof CreatePhotoBody>;
		const actor = actorOf(request);

		return created(await registerPhoto(actor, body));
	},
	{ preHandler: [...photoWrite], schema: { body: CreatePhotoBody } },
);

router.get(
	"/:id",
	async (request) => {
		const params = request.params as { id: string };
		const actor = actorOf(request);

		return getPhoto(actor, params.id);
	},
	{ preHandler: [...photoRead], schema: { params: IdParams } },
);

router.patch(
	"/:id",
	async (request) => {
		const params = request.params as { id: string };
		const body = request.body as Static<typeof UpdatePhotoBody>;
		const actor = actorOf(request);

		return updatePhotoRecord(actor, params.id, body);
	},
	{ preHandler: [...photoWrite], schema: { params: IdParams, body: UpdatePhotoBody } },
);

router.post(
	"/:id/publish",
	async (request) => {
		const params = request.params as { id: string };
		const actor = actorOf(request);

		return publishPhoto(actor, params.id);
	},
	{ preHandler: [...photoWrite], schema: { params: IdParams } },
);

router.post(
	"/:id/unpublish",
	async (request) => {
		const params = request.params as { id: string };
		const actor = actorOf(request);

		return unpublishPhoto(actor, params.id);
	},
	{ preHandler: [...photoWrite], schema: { params: IdParams } },
);

router.delete(
	"/:id",
	async (request) => {
		const params = request.params as { id: string };
		const actor = actorOf(request);

		await deletePhotoRecord(actor, params.id);

		return { status: "deleted" };
	},
	{ preHandler: [...photoWrite], schema: { params: IdParams } },
);
