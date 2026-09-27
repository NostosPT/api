import type { Static } from "typebox";
import { requireAuth, requireRole } from "../../auth/context.js";
import { AuthenticationError } from "../../errors/appError.js";
import { created } from "../../http/respond.js";
import { listAlbumFavorites } from "../favorites/service.js";
import { ListFavoritesQuery } from "../favorites/schemas.js";
import { createRouter } from "../../routing/router.js";
import {
	AlbumPhotoParams,
	CreateAlbumBody,
	IdParams,
	ListAlbumsQuery,
	SetAccessCodeBody,
	SetAlbumPhotosBody,
	UpdateAlbumBody,
	UpdateAlbumPhotoBody,
} from "./schemas.js";
import {
	archiveAlbum,
	clearAccessCode,
	createAlbumRecord,
	getAlbum,
	listAllAlbums,
	publishAlbum,
	rotateAlbum,
	setAccessCode,
	setAlbumPhotos,
	unpublishAlbum,
	updateAlbumPhotoRecord,
	updateAlbumRecord,
} from "./service.js";

function actorIdOf(request: { auth?: { user: { id: string } } }): string {
	const actorId = request.auth?.user.id;

	if (!actorId) {
		throw new AuthenticationError("Authentication required");
	}

	return actorId;
}

// Permission matrix (DECISIONS.md, "Albums (share/rotate)"): ADMIN manages,
// PHOTOGRAPHER and ASSISTANT hold CUD+P, EDITOR is read-only, ACCOUNTANT has
// no access. Roles are listed explicitly so a future role does not inherit.
const albumRead = [requireAuth, requireRole("ADMIN", "PHOTOGRAPHER", "EDITOR", "ASSISTANT")] as const;
const albumWrite = [requireAuth, requireRole("ADMIN", "PHOTOGRAPHER", "ASSISTANT")] as const;

export const router = createRouter();

router.get(
	"/",
	async (request) => {
		const query = request.query as Static<typeof ListAlbumsQuery>;
		const page = query.page ?? 1;
		const pageSize = query.pageSize ?? 20;

		return listAllAlbums(page, pageSize, {
			clientId: query.clientId,
			status: query.status,
			type: query.type,
			q: query.q,
		});
	},
	{ preHandler: [...albumRead], schema: { querystring: ListAlbumsQuery } },
);

router.post(
	"/",
	async (request) => {
		const body = request.body as Static<typeof CreateAlbumBody>;
		const actorId = actorIdOf(request);

		return created(await createAlbumRecord(actorId, body));
	},
	{ preHandler: [...albumWrite], schema: { body: CreateAlbumBody } },
);

router.get(
	"/:id",
	async (request) => {
		const params = request.params as { id: string };

		return getAlbum(params.id);
	},
	{ preHandler: [...albumRead], schema: { params: IdParams } },
);

router.patch(
	"/:id",
	async (request) => {
		const params = request.params as { id: string };
		const body = request.body as Static<typeof UpdateAlbumBody>;
		const actorId = actorIdOf(request);

		return updateAlbumRecord(actorId, params.id, body);
	},
	{ preHandler: [...albumWrite], schema: { params: IdParams, body: UpdateAlbumBody } },
);

router.post(
	"/:id/publish",
	async (request) => {
		const params = request.params as { id: string };
		const actorId = actorIdOf(request);

		return publishAlbum(actorId, params.id);
	},
	{ preHandler: [...albumWrite], schema: { params: IdParams } },
);

router.post(
	"/:id/unpublish",
	async (request) => {
		const params = request.params as { id: string };
		const actorId = actorIdOf(request);

		return unpublishAlbum(actorId, params.id);
	},
	{ preHandler: [...albumWrite], schema: { params: IdParams } },
);

router.post(
	"/:id/rotate",
	async (request) => {
		const params = request.params as { id: string };
		const actorId = actorIdOf(request);

		return rotateAlbum(actorId, params.id);
	},
	{ preHandler: [...albumWrite], schema: { params: IdParams } },
);

router.post(
	"/:id/access-code",
	async (request) => {
		const params = request.params as { id: string };
		const body = request.body as Static<typeof SetAccessCodeBody>;
		const actorId = actorIdOf(request);

		return setAccessCode(actorId, params.id, body.code);
	},
	{ preHandler: [...albumWrite], schema: { params: IdParams, body: SetAccessCodeBody } },
);

router.delete(
	"/:id/access-code",
	async (request) => {
		const params = request.params as { id: string };
		const actorId = actorIdOf(request);

		return clearAccessCode(actorId, params.id);
	},
	{ preHandler: [...albumWrite], schema: { params: IdParams } },
);

router.get(
	"/:id/favorites",
	async (request) => {
		const params = request.params as { id: string };
		const query = request.query as Static<typeof ListFavoritesQuery>;
		const page = query.page ?? 1;
		const pageSize = query.pageSize ?? 20;

		return listAlbumFavorites(params.id, page, pageSize, { clientId: query.clientId });
	},
	{ preHandler: [...albumRead], schema: { params: IdParams, querystring: ListFavoritesQuery } },
);

router.put(
	"/:id/photos",
	async (request) => {
		const params = request.params as { id: string };
		const body = request.body as Static<typeof SetAlbumPhotosBody>;
		const actorId = actorIdOf(request);

		return setAlbumPhotos(actorId, params.id, body);
	},
	{ preHandler: [...albumWrite], schema: { params: IdParams, body: SetAlbumPhotosBody } },
);

router.patch(
	"/:id/photos/:photoId",
	async (request) => {
		const params = request.params as { id: string; photoId: string };
		const body = request.body as Static<typeof UpdateAlbumPhotoBody>;
		const actorId = actorIdOf(request);

		return updateAlbumPhotoRecord(actorId, params.id, params.photoId, body.isPreview);
	},
	{
		preHandler: [...albumWrite],
		schema: {
			params: AlbumPhotoParams,
			body: UpdateAlbumPhotoBody,
		},
	},
);

router.delete(
	"/:id",
	async (request) => {
		const params = request.params as { id: string };
		const actorId = actorIdOf(request);

		await archiveAlbum(actorId, params.id);

		return { status: "archived" };
	},
	{ preHandler: [...albumWrite], schema: { params: IdParams } },
);
