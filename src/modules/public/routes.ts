import type { Static } from "typebox";
import { createRouter } from "../../routing/router.js";
import {
	ListPublicGalleriesQuery,
	ListPublicPhotosQuery,
	PhotoNumberParams,
	SlugParams,
} from "./schemas.js";
import {
	getPublicGallery,
	getPublicPhoto,
	listPublicGalleries,
	listPublicPhotos,
} from "./service.js";

export const router = createRouter();

router.get(
	"/galleries",
	async (request) => {
		const query = request.query as Static<typeof ListPublicGalleriesQuery>;
		const page = query.page ?? 1;
		const pageSize = query.pageSize ?? 20;

		return listPublicGalleries(page, pageSize);
	},
	{ schema: { querystring: ListPublicGalleriesQuery } },
);

router.get(
	"/galleries/:slug",
	async (request) => {
		const params = request.params as Static<typeof SlugParams>;

		return getPublicGallery(params.slug);
	},
	{ schema: { params: SlugParams } },
);

router.get(
	"/photos",
	async (request) => {
		const query = request.query as Static<typeof ListPublicPhotosQuery>;

		return listPublicPhotos(query);
	},
	{ schema: { querystring: ListPublicPhotosQuery } },
);

router.get(
	"/photos/:number",
	async (request) => {
		const params = request.params as Static<typeof PhotoNumberParams>;

		return getPublicPhoto(params.number);
	},
	{ schema: { params: PhotoNumberParams } },
);