import type { Static } from "typebox";
import { requireAuth, requireRole } from "../../auth/context.js";
import { AuthenticationError } from "../../errors/appError.js";
import { created } from "../../http/respond.js";
import { createRouter } from "../../routing/router.js";
import {
	CreateGalleryBody,
	GalleryPhotoParams,
	IdParams,
	ListGalleriesQuery,
	SetGalleryPhotosBody,
	UpdateGalleryBody,
	UpdateGalleryPhotoBody,
} from "./schemas.js";
import {
	archiveGallery,
	createGalleryRecord,
	getGallery,
	listAllGalleries,
	publishGallery,
	setGalleryPhotos,
	unpublishGallery,
	updateGalleryPhotoRecord,
	updateGalleryRecord,
} from "./service.js";

function actorIdOf(request: { auth?: { user: { id: string } } }): string {
	const actorId = request.auth?.user.id;

	if (!actorId) {
		throw new AuthenticationError("Authentication required");
	}

	return actorId;
}

// Permission matrix (DECISIONS.md, "Public gallery curation (publish/feature)"):
// ADMIN M, PHOTOGRAPHER P, EDITOR P, ASSISTANT R, ACCOUNTANT —.
// Derived split of the P code (report in module summary): P covers the
// publish/feature curation named in the row — membership, featured flags,
// publish/unpublish — while C/U/D on the Gallery record itself (create,
// rename, reposition, archive) stays with ADMIN's M. Gallery membership is
// gallery-scoped data: photo records are untouched, so PHOTOGRAPHER's
// own-photos-only rule for photo mutations does not apply here. Roles are
// listed explicitly so a future role does not inherit.
const galleryRead = [requireAuth, requireRole("ADMIN", "PHOTOGRAPHER", "EDITOR", "ASSISTANT")] as const;
const galleryCurate = [requireAuth, requireRole("ADMIN", "PHOTOGRAPHER", "EDITOR")] as const;
const galleryManage = [requireAuth, requireRole("ADMIN")] as const;

export const router = createRouter();

router.get(
	"/",
	async (request) => {
		const query = request.query as Static<typeof ListGalleriesQuery>;
		const page = query.page ?? 1;
		const pageSize = query.pageSize ?? 20;

		return listAllGalleries(page, pageSize, { status: query.status, q: query.q });
	},
	{ preHandler: [...galleryRead], schema: { querystring: ListGalleriesQuery } },
);

router.post(
	"/",
	async (request) => {
		const body = request.body as Static<typeof CreateGalleryBody>;
		const actorId = actorIdOf(request);

		return created(await createGalleryRecord(actorId, body));
	},
	{ preHandler: [...galleryManage], schema: { body: CreateGalleryBody } },
);

router.get(
	"/:id",
	async (request) => {
		const params = request.params as { id: string };

		return getGallery(params.id);
	},
	{ preHandler: [...galleryRead], schema: { params: IdParams } },
);

router.patch(
	"/:id",
	async (request) => {
		const params = request.params as { id: string };
		const body = request.body as Static<typeof UpdateGalleryBody>;
		const actorId = actorIdOf(request);

		return updateGalleryRecord(actorId, params.id, body);
	},
	{ preHandler: [...galleryManage], schema: { params: IdParams, body: UpdateGalleryBody } },
);

router.post(
	"/:id/publish",
	async (request) => {
		const params = request.params as { id: string };
		const actorId = actorIdOf(request);

		return publishGallery(actorId, params.id);
	},
	{ preHandler: [...galleryCurate], schema: { params: IdParams } },
);

router.post(
	"/:id/unpublish",
	async (request) => {
		const params = request.params as { id: string };
		const actorId = actorIdOf(request);

		return unpublishGallery(actorId, params.id);
	},
	{ preHandler: [...galleryCurate], schema: { params: IdParams } },
);

router.put(
	"/:id/photos",
	async (request) => {
		const params = request.params as { id: string };
		const body = request.body as Static<typeof SetGalleryPhotosBody>;
		const actorId = actorIdOf(request);

		return setGalleryPhotos(actorId, params.id, body);
	},
	{ preHandler: [...galleryCurate], schema: { params: IdParams, body: SetGalleryPhotosBody } },
);

router.patch(
	"/:id/photos/:photoId",
	async (request) => {
		const params = request.params as { id: string; photoId: string };
		const body = request.body as Static<typeof UpdateGalleryPhotoBody>;
		const actorId = actorIdOf(request);

		return updateGalleryPhotoRecord(actorId, params.id, params.photoId, body.isFeatured);
	},
	{
		preHandler: [...galleryCurate],
		schema: {
			params: GalleryPhotoParams,
			body: UpdateGalleryPhotoBody,
		},
	},
);

router.delete(
	"/:id",
	async (request) => {
		const params = request.params as { id: string };
		const actorId = actorIdOf(request);

		await archiveGallery(actorId, params.id);

		return { status: "archived" };
	},
	{ preHandler: [...galleryManage], schema: { params: IdParams } },
);
