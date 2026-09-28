import type { Static } from "typebox";
import { createRouter } from "../../routing/router.js";
import {
	ListPublicGalleriesQuery,
	ListPublicPhotosQuery,
	PhotoNumberParams,
	SlugParams,
} from "./schemas.js";
import {
	getPublicAlbum,
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
	"/albums/:slug",
	async (request) => {
		const params = request.params as { slug: string };
		const query = request.query as {
			a?: string;
			exp?: string;
			code?: string;
		};

		return getPublicAlbum(params.slug, query.a, query.exp, query.code);
	},
	{
		schema: {
			params: { slug: { type: "string", pattern: "^[a-z0-9-]+$", minLength: 1, maxLength: 64 } },
			querystring: {
				type: "object",
				properties: {
					a: { type: "string", pattern: "^[A-Fa-f0-9]{64}$" },
					exp: { type: "string", pattern: "^\\d+$" },
					code: { type: "string", minLength: 4, maxLength: 32 },
				},
				additionalProperties: false,
			},
		},
	},
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