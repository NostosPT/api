// Logged-in studio staff using the back-office. Each VU is one staff member:
// it logs in once, keeps its session, and loops over weighted tasks with
// human think time between clicks. Staff are a fixed, small population
// (LT_STAFF_VUS): a studio doesn't add staff as public traffic grows.
//
// Writes only touch records the task itself created, or are idempotent
// edits on seeded records, so the seeded public catalogue stays stable.
import exec from "k6/execution";
import { sleep } from "k6";
import { api, ipFor, json, login } from "../lib/http.js";
import { fx } from "../lib/fixtures.js";
import { chance, int, isoDaysFromNow, pick, uid, weighted } from "../lib/random.js";

const THINK_MIN = Number(__ENV.LT_STAFF_THINK_MIN ?? 2);
const THINK_MAX = Number(__ENV.LT_STAFF_THINK_MAX ?? 6);

function think() {
	sleep(THINK_MIN + Math.random() * (THINK_MAX - THINK_MIN));
}

function click() {
	sleep(0.5 + Math.random() * 1.5);
}

let session = null;

export function staffSession(kind = "staff") {
	if (session === null) {
		const vu = exec.vu.idInTest;
		const email = fx.staffAccounts[(vu - 1) % fx.staffAccounts.length];
		const ip = ipFor(5_000_000 + vu);
		const token = login(email, fx.password, ip, kind);

		if (token === null) {
			sleep(5);
			return null;
		}

		session = { token, ip, email };
	}

	return session;
}

export function resetStaffSession() {
	session = null;
}

function opts(s, extra = {}) {
	return { ip: s.ip, session: s.token, kind: "staff", ...extra };
}

const pages = (max = 3) => weighted([[70, 1], [20, 2], [10, int(3, max)]]);

// --- Tasks -------------------------------------------------------------------

function dashboard(s) {
	api("GET", "/auth/me", "/auth/me", opts(s));
	api("GET", "/service-requests", "/service-requests?stage=NEW&pageSize=10", opts(s));
	api("GET", "/photos", "/photos?pageSize=24", opts(s));
	api("GET", "/clients", "/clients?pageSize=10", opts(s));
}

function clients(s) {
	const query = weighted([
		[50, `page=${pages(10)}&pageSize=20`],
		[25, `q=${encodeURIComponent(pick(["silva", "ana", "costa", "joão", "mar", "pe"]))}`],
		[15, `status=${pick(["LEAD", "ACTIVE", "PAST"])}&pageSize=20`],
		[10, "archived=true"],
	]);
	api("GET", "/clients", `/clients?${query}`, opts(s));
	click();
	const id = pick(fx.clientIds);
	api("GET", "/clients/:id", `/clients/${id}`, opts(s));
	api("GET", "/clients/:id/activity", `/clients/${id}/activity?pageSize=20`, opts(s));
	api("GET", "/albums", `/albums?clientId=${id}`, opts(s));
	api("GET", "/purchases", `/purchases?clientId=${id}`, opts(s));

	if (chance(0.3)) {
		click();
		api("PATCH", "/clients/:id", `/clients/${id}`, opts(s, { body: { notes: `Follow-up ${uid()}` }, ok: [200, 409] }));
	}
}

function newClient(s) {
	const res = api("POST", "/clients", "/clients", opts(s, {
		body: { name: `Load Test Client ${uid()}`, email: `client-${uid()}@clients.nostos.test`, phone: "+351910000001", status: "LEAD", source: "REFERRAL" },
	}));
	const client = json(res);

	if (client?.id) {
		click();
		api("GET", "/clients/:id", `/clients/${client.id}`, opts(s));
	}
}

function requests(s) {
	const filter = weighted([
		[40, `stage=${pick(["NEW", "QUALIFIED", "QUOTED", "BOOKED"])}`],
		[30, `page=${pages(10)}`],
		[15, `assigneeId=${pick(fx.userIds)}`],
		[15, `clientId=${pick(fx.clientIds)}`],
	]);
	api("GET", "/service-requests", `/service-requests?${filter}&pageSize=20`, opts(s));
	click();
	const id = pick(fx.requestIds);
	api("GET", "/service-requests/:id", `/service-requests/${id}`, opts(s));
	api("GET", "/service-requests/:id/notes", `/service-requests/${id}/notes`, opts(s));

	if (chance(0.5)) {
		click();
		api("POST", "/service-requests/:id/notes", `/service-requests/${id}/notes`, opts(s, { body: { body: `Called the client, ${uid()}` } }));
	}

	if (chance(0.3)) {
		click();
		api("PATCH", "/service-requests/:id", `/service-requests/${id}`, opts(s, {
			body: { stage: pick(["QUALIFIED", "QUOTED", "BOOKED"]), quoteCents: int(500, 3000) * 100, assigneeId: pick(fx.userIds) },
			// Seeded assignees include suspended users, which the API rejects.
			ok: [200, 400],
		}));
	}
}

function photos(s) {
	const filter = weighted([
		[35, `page=${pages(20)}`],
		[20, `status=${pick(["DRAFT", "APPROVED", "PUBLISHED"])}`],
		[15, `q=${encodeURIComponent(pick(fx.searchWords))}`],
		[10, `photographerId=${pick(fx.photographerIds)}`],
		[10, `availability=${pick(["AVAILABLE", "SOLD_OUT"])}`],
		[10, `visibility=${pick(["PUBLIC", "PRIVATE"])}`],
	]);
	api("GET", "/photos", `/photos?${filter}&pageSize=48`, opts(s));
	click();
	const id = pick(fx.photoIds);
	api("GET", "/photos/:id", `/photos/${id}`, opts(s));

	if (chance(0.4)) {
		click();
		api("PATCH", "/photos/:id", `/photos/${id}`, opts(s, { body: { location: pick(["Lisboa", "Porto", "Sintra"]) } }));
	}

	if (chance(0.3)) {
		const tag = pick(fx.tagIds);
		api("POST", "/photos/:id/tags/:tagId", `/photos/${id}/tags/${tag}`, opts(s, { ok: [200, 201, 204, 409] }));
		api("DELETE", "/photos/:id/tags/:tagId", `/photos/${id}/tags/${tag}`, opts(s, { ok: [200, 204, 404] }));
	}

	if (chance(0.2)) {
		const category = pick(fx.categoryIds);
		api("POST", "/photos/:id/categories/:categoryId", `/photos/${id}/categories/${category}`, opts(s, { ok: [200, 201, 204, 409] }));
		api("DELETE", "/photos/:id/categories/:categoryId", `/photos/${id}/categories/${category}`, opts(s, { ok: [200, 204, 404] }));
	}
}

function albumDelivery(s) {
	const sampleAlbum = pick(fx.albumSamples);
	api("GET", "/albums", `/albums?page=${pages(10)}&pageSize=20${chance(0.3) ? `&status=PUBLISHED` : ""}`, opts(s));
	api("GET", "/albums/:id", `/albums/${sampleAlbum.id}`, opts(s));
	api("GET", "/albums/:id/favorites", `/albums/${sampleAlbum.id}/favorites`, opts(s));
	click();

	if (!chance(0.5)) {
		return;
	}

	// Full delivery flow on a fresh album for a seeded client.
	const created = json(api("POST", "/albums", "/albums", opts(s, {
		body: { clientId: sampleAlbum.clientId, title: `Delivery ${uid()}`, type: pick(["WATERMARK", "PAID", "FREE"]), priceCents: 50000, packPriceCents: 9000, packSize: 10, expiresAt: isoDaysFromNow(60) },
	})));

	if (!created?.id) {
		return;
	}

	const albumId = created.id;
	const photoIds = [];

	for (let i = 0; i < int(30, 150); i++) {
		photoIds.push(pick(fx.photoIds));
	}

	click();
	api("PUT", "/albums/:id/photos", `/albums/${albumId}/photos`, opts(s, { body: { photoIds: [...new Set(photoIds)] } }));
	api("PATCH", "/albums/:id/photos/:photoId", `/albums/${albumId}/photos/${photoIds[0]}`, opts(s, { body: { isPreview: false } }));
	api("POST", "/albums/:id/tags/:tagId", `/albums/${albumId}/tags/${pick(fx.tagIds)}`, opts(s, { ok: [200, 201, 204, 409] }));
	api("PATCH", "/albums/:id", `/albums/${albumId}`, opts(s, { body: { description: "Your photos are ready." } }));
	click();
	// Access codes are Argon2id-hashed, as costly as a login.
	api("POST", "/albums/:id/access-code", `/albums/${albumId}/access-code`, opts(s, { body: { code: fx.accessCode } }));
	api("POST", "/albums/:id/publish", `/albums/${albumId}/publish`, opts(s));
	api("GET", "/albums/:id", `/albums/${albumId}`, opts(s));

	if (chance(0.3)) {
		api("POST", "/albums/:id/rotate", `/albums/${albumId}/rotate`, opts(s));
	}

	if (chance(0.5)) {
		click();
		const purchase = json(api("POST", "/purchases", "/purchases", opts(s, {
			body: { clientId: sampleAlbum.clientId, albumId, scope: "PHOTO", photoId: photoIds[0], priceCents: 2500 },
		})));

		if (purchase?.id) {
			api("PATCH", "/purchases/:id", `/purchases/${purchase.id}`, opts(s, { body: { status: "COMPLETED" } }));
		}
	}
	else {
		api("POST", "/albums/:id/unpublish", `/albums/${albumId}/unpublish`, opts(s));
		api("DELETE", "/albums/:id", `/albums/${albumId}`, opts(s));
	}
}

function purchases(s) {
	api("GET", "/purchases", `/purchases?page=${pages(10)}&pageSize=20${chance(0.4) ? `&status=${pick(["PENDING", "COMPLETED"])}` : ""}`, opts(s));
	click();
	api("GET", "/purchases/:id", `/purchases/${pick(fx.purchaseIds)}`, opts(s));

	if (chance(0.3)) {
		const album = pick(fx.albumSamples);
		const purchase = json(api("POST", "/purchases", "/purchases", opts(s, {
			body: { clientId: album.clientId, albumId: album.id, scope: "PACK", packPhotoIds: album.photoIds.slice(0, 5), priceCents: 9000, note: "Pack order" },
		})));

		if (purchase?.id) {
			api("PATCH", "/purchases/:id", `/purchases/${purchase.id}`, opts(s, { body: { status: pick(["COMPLETED", "FAILED"]) } }));
		}
	}
}

function galleries(s) {
	api("GET", "/galleries", `/galleries?page=${pages(5)}&pageSize=20`, opts(s));
	const id = pick(fx.galleryIds);
	api("GET", "/galleries/:id", `/galleries/${id}`, opts(s));
	click();

	if (!chance(0.25)) {
		return;
	}

	// Curate a new collection, publish it briefly, then archive it.
	const gallery = json(api("POST", "/galleries", "/galleries", opts(s, { body: { title: `Collection ${uid()}`, description: "Load test collection" } })));

	if (!gallery?.id) {
		return;
	}

	const photoIds = [...new Set(Array.from({ length: int(20, 80) }, () => pick(fx.photoIds)))];
	api("PUT", "/galleries/:id/photos", `/galleries/${gallery.id}/photos`, opts(s, { body: { photoIds } }));
	api("PATCH", "/galleries/:id/photos/:photoId", `/galleries/${gallery.id}/photos/${photoIds[0]}`, opts(s, { body: { isFeatured: true } }));
	api("PATCH", "/galleries/:id", `/galleries/${gallery.id}`, opts(s, { body: { description: "Updated" } }));
	click();
	api("POST", "/galleries/:id/publish", `/galleries/${gallery.id}/publish`, opts(s));
	api("POST", "/galleries/:id/unpublish", `/galleries/${gallery.id}/unpublish`, opts(s));
	api("DELETE", "/galleries/:id", `/galleries/${gallery.id}`, opts(s));
}

function atlas(s) {
	api("GET", "/atlas/locations", `/atlas/locations?pageSize=50${chance(0.3) ? `&country=${pick(fx.atlasCountries)}` : ""}`, opts(s));
	const id = pick(fx.atlasIds);
	api("GET", "/atlas/locations/:id", `/atlas/locations/${id}`, opts(s));

	if (chance(0.3)) {
		click();
		api("PATCH", "/atlas/locations/:id", `/atlas/locations/${id}`, opts(s, { body: { accessNotes: `Parking near the entrance ${uid()}` } }));
	}
}

function taxonomy(s) {
	api("GET", "/tags", `/tags?pageSize=100${chance(0.3) ? `&q=${pick(fx.searchWords)}` : ""}`, opts(s));
	api("GET", "/categories", "/categories?pageSize=100", opts(s));
	api("GET", "/tags/:id", `/tags/${pick(fx.tagIds)}`, opts(s));
	api("GET", "/categories/:id", `/categories/${pick(fx.categoryIds)}`, opts(s));

	if (chance(0.2)) {
		click();
		const slug = `lt-${uid()}`;
		const tag = json(api("POST", "/tags", "/tags", opts(s, { body: { name: slug, slug, visibility: "INTERNAL" } })));

		if (tag?.id) {
			api("PATCH", "/tags/:id", `/tags/${tag.id}`, opts(s, { body: { description: "temporary" } }));
			api("DELETE", "/tags/:id", `/tags/${tag.id}`, opts(s));
		}
	}
}

function admin(s) {
	api("GET", "/users", "/users?pageSize=50", opts(s));
	api("GET", "/users/:id", `/users/${pick(fx.userIds)}`, opts(s));
	api("GET", "/invites", "/invites", opts(s));
	api("GET", "/system/status", "/system/status", opts(s));
}

function relogin(s) {
	// Session churn: Argon2id verification on every login is the most
	// CPU/RAM-expensive single operation in the API.
	api("POST", "/auth/logout", "/auth/logout", opts(s));
	resetStaffSession();
	staffSession();
}

const TASKS = [
	[14, dashboard],
	[14, clients],
	[4, newClient],
	[16, requests],
	[18, photos],
	[10, albumDelivery],
	[6, purchases],
	[6, galleries],
	[4, atlas],
	[4, taxonomy],
	[2, admin],
	[2, relogin],
];

export function staffIteration() {
	const s = staffSession();

	if (s === null) {
		return;
	}

	// A real staff member has one IP, but a busy back-office session exceeds
	// the global 100 req / 15 min limit within minutes. Rotating the address
	// per task keeps the limiter from throttling the measurement; the report
	// shows the per-user request rate against that limit separately.
	s.ip = ipFor(5_000_000 + exec.vu.idInTest * 10_000 + (exec.vu.iterationInScenario % 10_000));

	weighted(TASKS)(s);
	think();
}
