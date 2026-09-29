import type { Static } from "typebox";
import { requireAuth, requireRole } from "../../auth/context.js";
import { AuthenticationError } from "../../errors/appError.js";
import { created } from "../../http/respond.js";
import { createRouter } from "../../routing/router.js";
import {
	CreateLocationBody,
	IdParams,
	ListLocationsQuery,
	SetLocationCategoriesBody,
	SetLocationPhotosBody,
	UpdateLocationBody,
} from "./schemas.js";
import {
	archiveLocation,
	createLocationRecord,
	getLocation,
	listAllAtlasLocations,
	parseBbox,
	publishLocation,
	setLocationCategories,
	setLocationPhotos,
	unpublishLocation,
	updateLocationRecord,
} from "./service.js";

function actorIdOf(request: { auth?: { user: { id: string } } }): string {
	const actorId = request.auth?.user.id;

	if (!actorId) {
		throw new AuthenticationError("Authentication required");
	}

	return actorId;
}

// Permission matrix (Field Atlas): every delivery role reads locations;
// ADMIN, PHOTOGRAPHER and EDITOR curate content; ADMIN alone publishes,
// unpublishes and archives. Roles are listed explicitly so a future role
// does not inherit access by default.
const atlasRead = [requireAuth, requireRole("ADMIN", "PHOTOGRAPHER", "EDITOR", "ASSISTANT")] as const;
const atlasCurate = [requireAuth, requireRole("ADMIN", "PHOTOGRAPHER", "EDITOR")] as const;
const atlasManage = [requireAuth, requireRole("ADMIN")] as const;

export const router = createRouter();

router.get(
	"/",
	async (request) => {
		const query = request.query as Static<typeof ListLocationsQuery>;
		const page = query.page ?? 1;
		const pageSize = query.pageSize ?? 20;

		return listAllAtlasLocations(page, pageSize, {
			status: query.status,
			country: query.country,
			category: query.category,
			q: query.q,
			bbox: query.bbox === undefined ? undefined : parseBbox(query.bbox),
		});
	},
	{ preHandler: [...atlasRead], schema: { querystring: ListLocationsQuery } },
);

router.post(
	"/",
	async (request) => {
		const body = request.body as Static<typeof CreateLocationBody>;
		const actorId = actorIdOf(request);

		return created(await createLocationRecord(actorId, body));
	},
	{ preHandler: [...atlasCurate], schema: { body: CreateLocationBody } },
);

router.get(
	"/:id",
	async (request) => {
		const params = request.params as { id: string };

		return getLocation(params.id);
	},
	{ preHandler: [...atlasRead], schema: { params: IdParams } },
);

router.patch(
	"/:id",
	async (request) => {
		const params = request.params as { id: string };
		const body = request.body as Static<typeof UpdateLocationBody>;
		const actorId = actorIdOf(request);

		return updateLocationRecord(actorId, params.id, body);
	},
	{ preHandler: [...atlasCurate], schema: { params: IdParams, body: UpdateLocationBody } },
);

router.post(
	"/:id/publish",
	async (request) => {
		const params = request.params as { id: string };
		const actorId = actorIdOf(request);

		return publishLocation(actorId, params.id);
	},
	{ preHandler: [...atlasManage], schema: { params: IdParams } },
);

router.post(
	"/:id/unpublish",
	async (request) => {
		const params = request.params as { id: string };
		const actorId = actorIdOf(request);

		return unpublishLocation(actorId, params.id);
	},
	{ preHandler: [...atlasManage], schema: { params: IdParams } },
);

router.put(
	"/:id/photos",
	async (request) => {
		const params = request.params as { id: string };
		const body = request.body as Static<typeof SetLocationPhotosBody>;
		const actorId = actorIdOf(request);

		return setLocationPhotos(actorId, params.id, body);
	},
	{ preHandler: [...atlasCurate], schema: { params: IdParams, body: SetLocationPhotosBody } },
);

router.put(
	"/:id/categories",
	async (request) => {
		const params = request.params as { id: string };
		const body = request.body as Static<typeof SetLocationCategoriesBody>;
		const actorId = actorIdOf(request);

		return setLocationCategories(actorId, params.id, body);
	},
	{ preHandler: [...atlasCurate], schema: { params: IdParams, body: SetLocationCategoriesBody } },
);

router.delete(
	"/:id",
	async (request) => {
		const params = request.params as { id: string };
		const actorId = actorIdOf(request);

		await archiveLocation(actorId, params.id);

		return { status: "archived" };
	},
	{ preHandler: [...atlasManage], schema: { params: IdParams } },
);
