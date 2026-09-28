import type { Static } from "typebox";
import { createRouter } from "../../routing/router.js";
import { Type } from "typebox";
import { ValidationError } from "../../errors/appError.js";
import { getPublicAlbum, generateAlbumCapability } from "./public.service.js";

const StrictObject = { additionalProperties: false } as const;

export const PublicAlbumParams = Type.Object(
	{ slug: Type.String({ pattern: "^[a-z0-9-]+$", minLength: 1, maxLength: 64 }) },
	StrictObject,
);

export type PublicAlbumParams = Static<typeof PublicAlbumParams>;

export const AlbumAccessQuery = Type.Object(
	{
		a: Type.Optional(Type.String({ pattern: "^[A-Fa-f0-9]{64}$" })), // HMAC-SHA256 hex
		exp: Type.Optional(Type.String({ pattern: "^\\d+$" })),
		code: Type.Optional(Type.String({ minLength: 4, maxLength: 32 })),
	},
	StrictObject,
);

export type AlbumAccessQuery = Static<typeof AlbumAccessQuery>;

export const GenerateCapabilityBody = Type.Object(
	{ expSeconds: Type.Optional(Type.Integer({ minimum: 60, maximum: 7 * 24 * 60 * 60 })) },
	StrictObject,
);

export type GenerateCapabilityBody = Static<typeof GenerateCapabilityBody>;

export const router = createRouter();

// Public album access endpoint
router.get(
	"/albums/:slug",
	async (request) => {
		const params = request.params as Static<typeof PublicAlbumParams>;
		const query = request.query as Static<typeof AlbumAccessQuery>;

		return getPublicAlbum(params.slug, query.a, query.exp, query.code);
	},
	{ schema: { params: PublicAlbumParams, querystring: AlbumAccessQuery } },
);

// Staff endpoint to generate capability link
router.post(
	"/:id/capability",
	async (request) => {
		const params = request.params as { id: string };
		const body = request.body as Static<typeof GenerateCapabilityBody>;
		const actorId = request.auth?.user?.id;

		if (!actorId) {
			throw new ValidationError("Authentication required");
		}

		const expSeconds = body.expSeconds ?? 24 * 60 * 60;

		return generateAlbumCapability(actorId, params.id, expSeconds);
	},
	{ schema: { params: { id: Type.String({ pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$" }) }, body: GenerateCapabilityBody } },
);