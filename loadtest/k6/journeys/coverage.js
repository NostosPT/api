// Every endpoint, once, with its expected status. Used by the smoke profile to
// prove the stack, seed and request shapes are right before any load run.
// Write flows work on records they create, then clean them up.
import { group } from "k6";
import { api, ipFor, json, login } from "../lib/http.js";
import { fx } from "../lib/fixtures.js";
import { pick, uid } from "../lib/random.js";
import { uploadPhoto } from "./uploader.js";

const K = "coverage";

// Each section uses a fresh client address: the whole pass is ~110 requests,
// more than the global limit of 100 per IP per 15 minutes.
function section(name, o, pub, fn) {
	const ip = ipFor(9_000_000 + Math.floor(Math.random() * 1_000_000));
	o.ip = ip;
	pub.ip = ip;
	group(name, fn);
}

export async function coverageIteration() {
	const ip = ipFor(9_000_000 + Math.floor(Math.random() * 100_000));
	const email = fx.staffAccounts[fx.staffAccounts.length - 1];
	const token = login(email, fx.password, ip, K);
	const o = { ip, session: token, kind: K };
	const pub = { ip, kind: K };

	section("infra", o, pub, () => {
		api("GET", "/health", "/health", pub);
		api("GET", "/ready", "/ready", pub);
	});

	section("public", o, pub, () => {
		api("GET", "/public/galleries", "/public/galleries", pub);
		api("GET", "/public/galleries/:slug", `/public/galleries/${pick(fx.gallerySlugs)}`, pub);
		api("GET", "/public/photos", "/public/photos?sort=newest", pub);
		api("GET", "/public/photos/:number", `/public/photos/${pick(fx.photoNumbers)}`, pub);
		api("GET", "/public/atlas/locations", "/public/atlas/locations", pub);
		api("GET", "/public/atlas/locations/:slug", `/public/atlas/locations/${pick(fx.atlasSlugs)}`, pub);
		api("GET", "/services", "/services", pub);
		api("GET", "/services/:slug", `/services/${pick(fx.serviceSlugs)}`, pub);
	});

	section("auth", o, pub, () => {
		api("GET", "/auth/me", "/auth/me", o);
		api("GET", "/auth/me", "/auth/me", { ...pub, ok: [401] });
		const token2 = login(email, fx.password, ip, K);
		api("POST", "/auth/logout-all", "/auth/logout-all", { ...o, session: token2 });
		const inviteToken = pick(fx.inviteTokens);
		api("POST", "/auth/accept-invite", "/auth/accept-invite", { ...pub, body: { token: inviteToken, name: "Invited Staff", password: "invited-password-0001" }, ok: [200, 201] });
	});

	// logout-all revoked the first session too.
	const fresh = login(email, fx.password, ip, K);
	o.session = fresh;

	section("users & invites", o, pub, () => {
		api("GET", "/users", "/users", o);
		const user = json(api("POST", "/users", "/users", { ...o, body: { email: `user-${uid()}@loadtest.nostos.test`, name: "Coverage User", password: "coverage-password-0001", role: "EDITOR" }, ok: [201] }));
		api("GET", "/users/:id", `/users/${user?.id}`, o);
		api("PATCH", "/users/:id", `/users/${user?.id}`, { ...o, body: { name: "Coverage User Renamed" } });
		api("DELETE", "/users/:id", `/users/${user?.id}`, o);
		const invite = json(api("POST", "/invites", "/invites", { ...o, body: { email: `invite-${uid()}@loadtest.nostos.test`, role: "ASSISTANT" }, ok: [201] }));
		api("GET", "/invites", "/invites", o);
		api("DELETE", "/invites/:id", `/invites/${invite?.id}`, { ...o, ok: [200, 204] });
	});

	section("taxonomy & services", o, pub, () => {
		const slug = `cov-${uid()}`;
		const tag = json(api("POST", "/tags", "/tags", { ...o, body: { name: slug, slug }, ok: [201] }));
		api("GET", "/tags", "/tags", o);
		api("GET", "/tags/:id", `/tags/${tag?.id}`, o);
		api("PATCH", "/tags/:id", `/tags/${tag?.id}`, { ...o, body: { visibility: "INTERNAL" } });
		api("DELETE", "/tags/:id", `/tags/${tag?.id}`, { ...o, ok: [200, 204] });

		const category = json(api("POST", "/categories", "/categories", { ...o, body: { name: slug, slug }, ok: [201] }));
		api("GET", "/categories", "/categories", o);
		api("GET", "/categories/:id", `/categories/${category?.id}`, o);
		api("PATCH", "/categories/:id", `/categories/${category?.id}`, { ...o, body: { description: "coverage" } });
		api("POST", "/categories/:id/move", `/categories/${category?.id}/move`, { ...o, body: { direction: "up" } });
		api("DELETE", "/categories/:id", `/categories/${category?.id}`, { ...o, ok: [200, 204] });

		const service = json(api("POST", "/services", "/services", { ...o, body: { slug, name: `Service ${slug}`, priceFromCents: 1000, priceToCents: 2000 }, ok: [201] }));
		api("PATCH", "/services/:id", `/services/${service?.id}`, { ...o, body: { description: "coverage" } });
		api("POST", "/services/:id/move", `/services/${service?.id}/move`, { ...o, body: { direction: "up" } });
		api("PATCH", "/services/:id/deactivate", `/services/${service?.id}/deactivate`, o);
		api("DELETE", "/services/:id", `/services/${service?.id}`, { ...o, ok: [200, 204] });
	});

	section("clients & requests", o, pub, () => {
		const client = json(api("POST", "/clients", "/clients", { ...o, body: { name: "Coverage Client", email: `cov-${uid()}@clients.nostos.test` }, ok: [201] }));
		api("GET", "/clients", "/clients?q=coverage", o);
		api("GET", "/clients/:id", `/clients/${client?.id}`, o);
		api("PATCH", "/clients/:id", `/clients/${client?.id}`, { ...o, body: { status: "ACTIVE" } });
		api("GET", "/clients/:id/activity", `/clients/${client?.id}/activity`, o);
		api("DELETE", "/clients/:id", `/clients/${client?.id}`, o);

		const request = json(api("POST", "/service-requests", "/service-requests", { ...pub, body: { service: pick(fx.serviceSlugs), contact: { name: "Coverage", email: `cov-${uid()}@visitors.nostos.test` } }, ok: [201] }));
		api("GET", "/service-requests", "/service-requests", o);
		api("GET", "/service-requests/:id", `/service-requests/${request?.id}`, o);
		api("PATCH", "/service-requests/:id", `/service-requests/${request?.id}`, { ...o, body: { stage: "QUALIFIED" } });
		api("POST", "/service-requests/:id/notes", `/service-requests/${request?.id}/notes`, { ...o, body: { body: "coverage note" }, ok: [201] });
		api("GET", "/service-requests/:id/notes", `/service-requests/${request?.id}/notes`, o);
	});

	// Photos: real upload (smallest file), then the full lifecycle.
	const photo = await uploadPhoto({ ip, token: fresh }, K, undefined);

	section("photos", o, pub, () => {
		const id = photo?.id;
		const category = pick(fx.categoryIds);
		const tagId = pick(fx.tagIds);
		api("GET", "/photos", "/photos", o);
		api("GET", "/photos/:id", `/photos/${id}`, o);
		api("PATCH", "/photos/:id", `/photos/${id}`, { ...o, body: { title: "Coverage photo" } });
		api("POST", "/photos/:id/categories/:categoryId", `/photos/${id}/categories/${category}`, { ...o, ok: [200, 201, 204] });
		api("DELETE", "/photos/:id/categories/:categoryId", `/photos/${id}/categories/${category}`, { ...o, ok: [200, 204] });
		api("POST", "/photos/:id/tags/:tagId", `/photos/${id}/tags/${tagId}`, { ...o, ok: [200, 201, 204] });
		api("DELETE", "/photos/:id/tags/:tagId", `/photos/${id}/tags/${tagId}`, { ...o, ok: [200, 204] });
		api("POST", "/photos/:id/publish", `/photos/${id}/publish`, o);
		api("POST", "/photos/:id/publish", `/photos/${id}/publish`, o);
		api("POST", "/photos/:id/unpublish", `/photos/${id}/unpublish`, o);
		api("DELETE", "/photos/:id", `/photos/${id}`, { ...o, ok: [200, 204] });
	});

	section("albums & purchases", o, pub, () => {
		const sample = pick(fx.albumSamples);
		const album = json(api("POST", "/albums", "/albums", { ...o, body: { clientId: sample.clientId, title: "Coverage album", type: "WATERMARK", packPriceCents: 5000, packSize: 5 }, ok: [201] }));
		const id = album?.id;
		const tagId = pick(fx.tagIds);
		api("GET", "/albums", "/albums", o);
		api("PUT", "/albums/:id/photos", `/albums/${id}/photos`, { ...o, body: { photoIds: sample.photoIds } });
		api("PATCH", "/albums/:id/photos/:photoId", `/albums/${id}/photos/${sample.photoIds[0]}`, { ...o, body: { isPreview: true } });
		api("PATCH", "/albums/:id", `/albums/${id}`, { ...o, body: { title: "Coverage album v2" } });
		api("POST", "/albums/:id/tags/:tagId", `/albums/${id}/tags/${tagId}`, { ...o, ok: [200, 201, 204] });
		api("DELETE", "/albums/:id/tags/:tagId", `/albums/${id}/tags/${tagId}`, { ...o, ok: [200, 204] });
		api("POST", "/albums/:id/access-code", `/albums/${id}/access-code`, { ...o, body: { code: fx.accessCode } });
		api("DELETE", "/albums/:id/access-code", `/albums/${id}/access-code`, { ...o, ok: [200, 204] });
		api("POST", "/albums/:id/access-code", `/albums/${id}/access-code`, { ...o, body: { code: fx.accessCode } });
		api("POST", "/albums/:id/publish", `/albums/${id}/publish`, o);
		api("GET", "/albums/:id", `/albums/${id}`, o);
		api("GET", "/albums/:id/favorites", `/albums/${id}/favorites`, o);
		api("POST", "/albums/:id/rotate", `/albums/${id}/rotate`, o);

		const purchase = json(api("POST", "/purchases", "/purchases", { ...o, body: { clientId: sample.clientId, albumId: id, scope: "PACK", packPhotoIds: sample.photoIds.slice(0, 3), priceCents: 5000 }, ok: [201] }));
		api("GET", "/purchases", "/purchases", o);
		api("GET", "/purchases/:id", `/purchases/${purchase?.id}`, o);
		api("PATCH", "/purchases/:id", `/purchases/${purchase?.id}`, { ...o, body: { status: "COMPLETED" } });

		api("POST", "/albums/:id/unpublish", `/albums/${id}/unpublish`, o);
		api("DELETE", "/albums/:id", `/albums/${id}`, { ...o, ok: [200, 204] });
	});

	section("galleries", o, pub, () => {
		const gallery = json(api("POST", "/galleries", "/galleries", { ...o, body: { title: "Coverage gallery" }, ok: [201] }));
		const id = gallery?.id;
		const photoIds = [pick(fx.photoIds), pick(fx.photoIds)];
		api("GET", "/galleries", "/galleries", o);
		api("GET", "/galleries/:id", `/galleries/${id}`, o);
		api("PATCH", "/galleries/:id", `/galleries/${id}`, { ...o, body: { description: "coverage" } });
		api("PUT", "/galleries/:id/photos", `/galleries/${id}/photos`, { ...o, body: { photoIds: [...new Set(photoIds)] } });
		api("PATCH", "/galleries/:id/photos/:photoId", `/galleries/${id}/photos/${photoIds[0]}`, { ...o, body: { isFeatured: true } });
		api("POST", "/galleries/:id/publish", `/galleries/${id}/publish`, o);
		api("POST", "/galleries/:id/unpublish", `/galleries/${id}/unpublish`, o);
		api("DELETE", "/galleries/:id", `/galleries/${id}`, { ...o, ok: [200, 204] });
	});

	section("atlas", o, pub, () => {
		const location = json(api("POST", "/atlas/locations", "/atlas/locations", { ...o, body: { name: "Coverage spot", country: "PT", latitude: 38.7, longitude: -9.1 }, ok: [201] }));
		const id = location?.id;
		api("GET", "/atlas/locations", "/atlas/locations", o);
		api("GET", "/atlas/locations/:id", `/atlas/locations/${id}`, o);
		api("PATCH", "/atlas/locations/:id", `/atlas/locations/${id}`, { ...o, body: { city: "Lisboa" } });
		api("PUT", "/atlas/locations/:id/photos", `/atlas/locations/${id}/photos`, { ...o, body: { photoIds: [pick(fx.photoIds)] } });
		api("PUT", "/atlas/locations/:id/categories", `/atlas/locations/${id}/categories`, { ...o, body: { categorySlugs: [pick(fx.categorySlugs)] } });
		api("POST", "/atlas/locations/:id/publish", `/atlas/locations/${id}/publish`, o);
		api("POST", "/atlas/locations/:id/unpublish", `/atlas/locations/${id}/unpublish`, o);
		api("DELETE", "/atlas/locations/:id", `/atlas/locations/${id}`, { ...o, ok: [200, 204] });
	});

	section("system", o, pub, () => {
		api("GET", "/system/status", "/system/status", o);
		api("POST", "/auth/logout", "/auth/logout", o);
	});
}
