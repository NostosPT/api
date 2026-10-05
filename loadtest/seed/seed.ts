// Load-test data generator. Fills the isolated load-test database with
// realistic, internally consistent mock data, then writes the fixtures k6
// needs (ids, slugs, credentials) to loadtest/.data/fixtures.json.
//
//   pnpm exec tsx loadtest/seed/seed.ts             # SCALE=1 (~1 year of studio activity)
//   LT_SCALE=5 pnpm exec tsx loadtest/seed/seed.ts  # growth projection (run.sh reseeds automatically)
//
// Refuses to run against anything but the load-test database (see guard()).
// Deterministic: the same LT_SCALE and LT_SEED produce the same data shape.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { hashPassword } from "../../src/auth/password.js";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(DIR, "../.data");

const DATABASE_URL = process.env.LT_DATABASE_URL ?? "postgresql://nostos:nostos-loadtest@127.0.0.1:55432/nostos_loadtest";
const SCALE = Number.parseFloat(process.env.LT_SCALE ?? "1");
const STAFF_ACCOUNTS = Number.parseInt(process.env.LT_STAFF_ACCOUNTS ?? "40", 10);

// Shared credentials for every load-test account. Test-only values.
export const STAFF_PASSWORD = "loadtest-password-0001";
export const ALBUM_ACCESS_CODE = "LOADTEST01";

// ---------------------------------------------------------------------------
// Deterministic randomness
// ---------------------------------------------------------------------------

let rngState = Number.parseInt(process.env.LT_SEED ?? "20261003", 10) >>> 0;

function rand(): number {
	// mulberry32
	rngState = (rngState + 0x6D2B79F5) >>> 0;
	let t = rngState;
	t = Math.imul(t ^ (t >>> 15), t | 1);
	t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function int(min: number, max: number): number {
	return min + Math.floor(rand() * (max - min + 1));
}

function pick<T>(items: readonly T[]): T {
	return items[Math.floor(rand() * items.length)];
}

function chance(p: number): boolean {
	return rand() < p;
}

function weighted<T extends string>(weights: Record<T, number>): T {
	const entries = Object.entries(weights) as [T, number][];
	const total = entries.reduce((sum, [, w]) => sum + w, 0);
	let roll = rand() * total;

	for (const [value, weight] of entries) {
		roll -= weight;

		if (roll <= 0) {
			return value;
		}
	}

	return entries[entries.length - 1][0];
}

function sample<T>(items: readonly T[], count: number): T[] {
	const copy = [...items];
	const n = Math.min(count, copy.length);

	for (let i = 0; i < n; i++) {
		const j = i + Math.floor(rand() * (copy.length - i));
		[copy[i], copy[j]] = [copy[j], copy[i]];
	}

	return copy.slice(0, n);
}

const NOW = Date.now();
const DAY = 24 * 60 * 60 * 1000;

function daysAgo(maxDays: number, minDays = 0): Date {
	return new Date(NOW - (minDays + rand() * (maxDays - minDays)) * DAY);
}

function scaled(base: number): number {
	return Math.max(1, Math.round(base * SCALE));
}

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

const FIRST = ["Ana", "João", "Maria", "Pedro", "Inês", "Tiago", "Sofia", "Rui", "Beatriz", "Miguel", "Carla", "Nuno", "Rita", "Hugo", "Marta", "André", "Joana", "Luís", "Catarina", "Diogo", "Emma", "Lucas", "Chloé", "Mateo", "Lena", "Oliver"];
const LAST = ["Silva", "Santos", "Ferreira", "Pereira", "Oliveira", "Costa", "Rodrigues", "Martins", "Jesus", "Sousa", "Fernandes", "Gonçalves", "Gomes", "Lopes", "Marques", "Alves", "Almeida", "Ribeiro", "Pinto", "Carvalho", "Teixeira", "Moreira"];
const ADJ = ["golden", "quiet", "misty", "coastal", "urban", "wild", "silent", "bright", "hidden", "ancient", "northern", "late", "early", "blue", "amber", "salt", "stone", "winter", "summer", "autumn"];
const NOUN = ["harbor", "cliffs", "alley", "vineyard", "market", "chapel", "river", "bridge", "dunes", "forest", "lighthouse", "square", "terrace", "pier", "valley", "garden", "station", "tower", "beach", "ridge"];
const PLACES = ["Lisboa", "Porto", "Sintra", "Cascais", "Évora", "Coimbra", "Nazaré", "Aveiro", "Braga", "Lagos", "Tavira", "Madeira", "Açores", "Douro", "Peniche", "Óbidos"];
const COUNTRIES = ["PT", "PT", "PT", "PT", "ES", "ES", "FR", "IT", "MA", "IS"];
const CATEGORY_NAMES = ["Weddings", "Portraits", "Landscapes", "Street", "Architecture", "Events", "Nature", "Travel", "Food", "Fashion", "Documentary", "Aerial"];
const SERVICE_DEFS = [
	["wedding", "Wedding Photography", 150000, 400000],
	["portrait", "Portrait Session", 15000, 45000],
	["event", "Event Coverage", 40000, 150000],
	["family", "Family Session", 20000, 50000],
	["product", "Product Photography", 30000, 120000],
	["commercial", "Commercial Shoot", 80000, 300000],
] as const;

function personName(): string {
	return `${pick(FIRST)} ${pick(LAST)}`;
}

function phrase(): string {
	return `${pick(ADJ)} ${pick(NOUN)}`;
}

function sentence(words: number): string {
	const parts: string[] = [];

	for (let i = 0; i < words; i++) {
		parts.push(i % 2 === 0 ? pick(ADJ) : pick(NOUN));
	}

	const text = parts.join(" ");
	return `${text[0].toUpperCase()}${text.slice(1)}.`;
}

function slugify(value: string): string {
	return value.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function hashToken(token: string): string {
	return createHash("sha512").update(token, "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// Bulk insert via unnest(): one round trip per chunk, typed per column.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

async function insert(db: pg.PoolClient, table: string, columns: Record<string, string>, rows: Row[], chunkSize = 5000): Promise<void> {
	const names = Object.keys(columns);

	for (let offset = 0; offset < rows.length; offset += chunkSize) {
		const chunk = rows.slice(offset, offset + chunkSize);
		const params = names.map((name) => chunk.map((row) => {
			const value = row[name];

			if (value === undefined) {
				return null;
			}

			// jsonb and text[] travel as JSON text and are cast back in SQL.
			if (columns[name] === "jsonb" || columns[name] === "text[]") {
				return value === null ? null : JSON.stringify(value);
			}

			return value;
		}));
		const selects = names.map((name, i) => {
			const type = columns[name];

			if (type === "text[]") {
				return `ARRAY(SELECT jsonb_array_elements_text(c${i}::jsonb))`;
			}

			if (type === "jsonb") {
				return `c${i}::jsonb`;
			}

			return `c${i}`;
		});
		const unnestTypes = names.map((name, i) => {
			const type = columns[name] === "jsonb" || columns[name] === "text[]" ? "text" : columns[name];
			return `$${i + 1}::${type}[]`;
		});
		const aliases = names.map((_, i) => `c${i}`).join(", ");

		await db.query(
			`INSERT INTO "${table}" (${names.map((n) => `"${n}"`).join(", ")})
			 SELECT ${selects.join(", ")} FROM unnest(${unnestTypes.join(", ")}) AS t(${aliases})`,
			params,
		);
	}
}

// ---------------------------------------------------------------------------
// Safety
// ---------------------------------------------------------------------------

function guard(): void {
	const url = new URL(DATABASE_URL);
	const database = url.pathname.replace(/^\//, "");

	if (database !== "nostos_loadtest" || !["127.0.0.1", "localhost"].includes(url.hostname)) {
		throw new Error(`Refusing to seed ${url.hostname}/${database}: only the local nostos_loadtest database is allowed.`);
	}
}

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
	guard();

	const started = Date.now();
	const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 2 });
	const db = await pool.connect();
	const log = (message: string) => console.log(`[seed +${((Date.now() - started) / 1000).toFixed(1)}s] ${message}`);

	try {
		log(`scale=${SCALE} staffAccounts=${STAFF_ACCOUNTS}`);

		const tables = await db.query<{ tablename: string }>(
			"SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'",
		);
		await db.query(`TRUNCATE ${tables.rows.map((t) => `"${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
		log("truncated");

		const passwordHash = await hashPassword(STAFF_PASSWORD);
		const accessCodeHash = await hashPassword(ALBUM_ACCESS_CODE);
		const now = new Date(NOW);
		const year = new Date(NOW).getFullYear();

		// --- Staff ---------------------------------------------------------
		const users: Row[] = [];
		const directoryRoles = { ADMIN: 2, PHOTOGRAPHER: 8, EDITOR: 4, ASSISTANT: 4, ACCOUNTANT: 2 } as const;

		for (const [role, count] of Object.entries(directoryRoles)) {
			for (let i = 0; i < count; i++) {
				const name = personName();
				users.push({
					id: randomUUID(), email: `${slugify(name)}.${role.toLowerCase()}${i}@studio.nostos.test`, name, role,
					status: chance(0.9) ? "ACTIVE" : "SUSPENDED", passwordHash, bio: chance(0.5) ? sentence(12) : null,
					createdAt: daysAgo(900, 30), updatedAt: daysAgo(30),
				});
			}
		}

		const staffAccounts: { id: string; email: string }[] = [];

		for (let i = 0; i < STAFF_ACCOUNTS; i++) {
			const id = randomUUID();
			const email = `staff-${String(i).padStart(3, "0")}@loadtest.nostos.test`;
			staffAccounts.push({ id, email });
			users.push({ id, email, name: `Load Test Staff ${i}`, role: "ADMIN", status: "ACTIVE", passwordHash, bio: null, createdAt: daysAgo(400, 30), updatedAt: now });
		}

		await insert(db, "User", { id: "uuid", email: "citext", name: "text", role: '"Role"', status: '"UserStatus"', passwordHash: "text", bio: "text", createdAt: "timestamp(3)", updatedAt: "timestamp(3)" }, users);
		const photographers = users.filter((u) => u.role === "PHOTOGRAPHER").map((u) => u.id as string);
		const directoryUserIds = users.filter((u) => !(u.email as string).endsWith("@loadtest.nostos.test")).map((u) => u.id as string);
		const allStaffIds = users.map((u) => u.id as string);
		log(`users ${users.length}`);

		// Expired/revoked historical sessions (index realism only).
		const sessions: Row[] = [];

		for (let i = 0; i < scaled(2000); i++) {
			sessions.push({ id: randomUUID(), tokenHash: hashToken(randomBytes(32).toString("hex")), userId: pick(directoryUserIds), expiresAt: daysAgo(300, 1), lastSeenAt: daysAgo(330, 30), revokedAt: chance(0.4) ? daysAgo(300, 1) : null, createdAt: daysAgo(360, 31) });
		}

		await insert(db, "Session", { id: "uuid", tokenHash: "text", userId: "uuid", expiresAt: "timestamp(3)", lastSeenAt: "timestamp(3)", revokedAt: "timestamp(3)", createdAt: "timestamp(3)" }, sessions);

		// Pending invites with known tokens so accept-invite can be exercised.
		const inviteTokens: string[] = [];
		const invites: Row[] = [];

		for (let i = 0; i < 200; i++) {
			const token = randomBytes(32).toString("hex");
			inviteTokens.push(token);
			invites.push({ id: randomUUID(), email: `invitee-${i}@loadtest.nostos.test`, role: pick(["EDITOR", "ASSISTANT", "PHOTOGRAPHER"]), tokenHash: hashToken(token), invitedById: staffAccounts[0].id, expiresAt: new Date(NOW + 7 * DAY), acceptedAt: null, createdAt: now });
		}

		await insert(db, "Invite", { id: "uuid", email: "citext", role: '"Role"', tokenHash: "text", invitedById: "uuid", expiresAt: "timestamp(3)", acceptedAt: "timestamp(3)", createdAt: "timestamp(3)" }, invites);

		// --- Taxonomy & catalogue ------------------------------------------
		const categories = CATEGORY_NAMES.map((name, position) => ({ id: randomUUID(), name, slug: slugify(name), description: sentence(8), status: position < 11 ? "ACTIVE" : "INACTIVE", position, createdAt: daysAgo(900, 400), updatedAt: daysAgo(100) }));
		await insert(db, "Category", { id: "uuid", name: "text", slug: "text", description: "text", status: '"CategoryStatus"', position: "int4", createdAt: "timestamp(3)", updatedAt: "timestamp(3)" }, categories);

		const tagNames = new Set<string>();

		while (tagNames.size < scaled(60)) {
			tagNames.add(chance(0.5) ? phrase() : `${pick(PLACES)} ${pick(NOUN)}`);
		}

		const tags = [...tagNames].map((name) => ({ id: randomUUID(), name, slug: slugify(name), description: null, status: chance(0.92) ? "ACTIVE" : "INACTIVE", visibility: chance(0.8) ? "PUBLIC" : "INTERNAL", createdAt: daysAgo(800, 10), updatedAt: daysAgo(10) }));
		await insert(db, "Tag", { id: "uuid", name: "text", slug: "text", description: "text", status: '"TagStatus"', visibility: '"TagVisibility"', createdAt: "timestamp(3)", updatedAt: "timestamp(3)" }, tags);

		// Positions are 1-based, as the services module assumes.
		const services = SERVICE_DEFS.map(([slug, name, from, to], index) => ({ id: randomUUID(), slug, name, description: sentence(14), priceFromCents: from, priceToCents: to, currency: "EUR", active: true, position: index + 1, createdAt: daysAgo(900, 400), updatedAt: daysAgo(60) }));
		await insert(db, "Service", { id: "uuid", slug: "text", name: "text", description: "text", priceFromCents: "int4", priceToCents: "int4", currency: "text", active: "bool", position: "int4", createdAt: "timestamp(3)", updatedAt: "timestamp(3)" }, services);
		log(`categories ${categories.length}, tags ${tags.length}, services ${services.length}`);

		// --- Clients ---------------------------------------------------------
		// Codes are spread over past years; the current year stays below 1000
		// because generateNextClientCode() sorts codes as text.
		const clients: Row[] = [];
		const codeCounters = new Map<number, number>();

		for (let i = 0; i < scaled(3000); i++) {
			const createdAt = daysAgo(1200, 1);
			let codeYear = createdAt.getFullYear();

			if (codeYear === year && (codeCounters.get(year) ?? 0) >= 600) {
				codeYear = year - 1;
			}

			const next = (codeCounters.get(codeYear) ?? 0) + 1;
			codeCounters.set(codeYear, next);
			const name = personName();
			clients.push({
				id: randomUUID(), clientCode: `CLI-${codeYear}-${String(next).padStart(3, "0")}`, email: `${slugify(name)}.${i}@clients.nostos.test`, name,
				phone: chance(0.7) ? `+3519${int(10000000, 99999999)}` : null, company: chance(0.2) ? `${pick(LAST)} ${pick(["Lda", "SA", "Studio", "Events"])}` : null,
				notes: chance(0.3) ? sentence(20) : null, status: weighted({ LEAD: 3, ACTIVE: 5, PAST: 2 }), taxId: chance(0.4) ? String(int(100000000, 299999999)) : null,
				address: chance(0.5) ? `${pick(NOUN)} street ${int(1, 300)}, ${pick(PLACES)}` : null, source: weighted({ WEBSITE: 5, EMAIL: 2, REFERRAL: 2, INSTAGRAM: 3, ARCHIVE: 1 }),
				lastContactAt: daysAgo(200), deletedAt: chance(0.03) ? daysAgo(100) : null, createdAt, updatedAt: daysAgo(60),
			});
		}

		await insert(db, "Client", { id: "uuid", clientCode: "text", email: "citext", name: "text", phone: "text", company: "text", notes: "text", status: '"ClientStatus"', taxId: "text", address: "text", source: '"LeadSource"', lastContactAt: "timestamp(3)", deletedAt: "timestamp(3)", createdAt: "timestamp(3)", updatedAt: "timestamp(3)" }, clients);
		const liveClients = clients.filter((c) => c.deletedAt === null);
		log(`clients ${clients.length}`);

		const activities: Row[] = [];

		for (const client of clients) {
			for (let i = 0; i < int(0, 10); i++) {
				activities.push({ id: randomUUID(), clientId: client.id, kind: weighted({ NOTE: 4, EMAIL: 4, REQUEST: 2, GALLERY: 2, CALL: 2, INVOICE: 1, ORDER: 1 }), title: sentence(5), body: chance(0.6) ? sentence(25) : null, href: null, authorId: pick(directoryUserIds), createdAt: daysAgo(900) });
			}
		}

		await insert(db, "ClientActivity", { id: "uuid", clientId: "uuid", kind: '"ActivityKind"', title: "text", body: "text", href: "text", authorId: "uuid", createdAt: "timestamp(3)" }, activities);
		log(`client activity ${activities.length}`);

		// --- Service requests ----------------------------------------------
		const requests: Row[] = [];
		const refCounters = new Map<number, number>();

		for (let i = 0; i < scaled(10000); i++) {
			const createdAt = daysAgo(1100, 1);
			let refYear = createdAt.getFullYear();

			if (refYear === year && (refCounters.get(year) ?? 0) >= 600) {
				refYear = year - 1;
			}

			const next = (refCounters.get(refYear) ?? 0) + 1;
			refCounters.set(refYear, next);
			const client = pick(liveClients);
			const service = pick(services);
			const stage = weighted({ NEW: 2, QUALIFIED: 2, QUOTED: 2, BOOKED: 2, COMPLETED: 5, LOST: 2 });
			const budget = int(200, 4000) * 100;
			requests.push({
				id: randomUUID(), reference: `REQ-${refYear}-${String(next).padStart(3, "0")}`, title: `${service.name} - ${client.name}`, clientId: client.id, serviceId: service.id, stage,
				preferredDate: chance(0.7) ? daysAgo(-120, -400) : null, location: chance(0.8) ? pick(PLACES) : null, locationUndecided: chance(0.1),
				budgetMinCents: budget, budgetMaxCents: budget + int(0, 2000) * 100, estimateFromCents: stage === "NEW" ? null : budget, estimateToCents: stage === "NEW" ? null : budget * 2,
				quoteCents: ["QUOTED", "BOOKED", "COMPLETED"].includes(stage) ? budget + 50000 : null, quoteId: null, assigneeId: chance(0.7) ? pick(directoryUserIds) : null,
				source: weighted({ WEBSITE: 6, EMAIL: 2, REFERRAL: 1, INSTAGRAM: 2 }), lostReason: stage === "LOST" ? sentence(6) : null,
				contact: { email: client.email, name: client.name, phone: client.phone ?? undefined, preferredContact: pick(["email", "phone", "whatsapp"]) },
				answers: { guests: String(int(10, 250)), style: pick(ADJ), notes: sentence(10) }, referenceKeys: [], createdAt, updatedAt: daysAgo(60),
			});
		}

		await insert(db, "ServiceRequest", { id: "uuid", reference: "text", title: "text", clientId: "uuid", serviceId: "uuid", stage: '"ServiceRequestStage"', preferredDate: "timestamp(3)", location: "text", locationUndecided: "bool", budgetMinCents: "int4", budgetMaxCents: "int4", estimateFromCents: "int4", estimateToCents: "int4", quoteCents: "int4", quoteId: "text", assigneeId: "uuid", source: '"LeadSource"', lostReason: "text", contact: "jsonb", answers: "jsonb", referenceKeys: "text[]", createdAt: "timestamp(3)", updatedAt: "timestamp(3)" }, requests);

		const notes: Row[] = [];

		for (const request of requests) {
			for (let i = 0; i < int(0, 5); i++) {
				notes.push({ id: randomUUID(), requestId: request.id, authorId: pick(directoryUserIds), body: sentence(int(8, 40)), createdAt: daysAgo(900) });
			}
		}

		await insert(db, "RequestNote", { id: "uuid", requestId: "uuid", authorId: "uuid", body: "text", createdAt: "timestamp(3)" }, notes);
		log(`service requests ${requests.length}, notes ${notes.length}`);

		// --- Photos ----------------------------------------------------------
		const photos: Row[] = [];

		for (let i = 0; i < scaled(50000); i++) {
			const id = randomUUID();
			const status = weighted({ PUBLISHED: 60, APPROVED: 15, DRAFT: 25 });
			const uploadStatus = chance(0.01) ? "PENDING" : chance(0.005) ? "FAILED" : "READY";
			const visibility = status === "PUBLISHED" ? weighted({ PUBLIC: 9, UNLISTED: 1 }) : weighted({ PRIVATE: 8, PUBLIC: 2 });
			const availability = weighted({ NOT_FOR_SALE: 5, AVAILABLE: 4, SOLD_OUT: 1 });
			const createdAt = daysAgo(1000, 1);
			const hasRenditions = uploadStatus === "READY" && chance(0.9);
			photos.push({
				id, title: chance(0.9) ? `${phrase()} ${pick(PLACES)}` : null, description: chance(0.6) ? sentence(int(6, 30)) : null,
				originalKey: `originals/${id}.jpg`, displayKey: hasRenditions ? `display/${id}.webp` : null, thumbnailKey: hasRenditions ? `thumbs/${id}.webp` : null,
				width: 6000, height: 4000, takenAt: chance(0.9) ? daysAgo(1800, 1) : null, location: chance(0.7) ? pick(PLACES) : null,
				status: uploadStatus === "READY" ? status : "DRAFT", visibility: uploadStatus === "READY" ? visibility : "PRIVATE", availability,
				priceCents: availability === "NOT_FOR_SALE" ? null : int(10, 300) * 100, currency: "EUR", photographerId: chance(0.9) ? pick(photographers) : null,
				uploadStatus, createdAt, updatedAt: createdAt,
			});
		}

		await insert(db, "Photo", { id: "uuid", title: "text", description: "text", originalKey: "text", displayKey: "text", thumbnailKey: "text", width: "int4", height: "int4", takenAt: "timestamp(3)", location: "text", status: '"PhotoStatus"', visibility: '"Visibility"', availability: '"Availability"', priceCents: "int4", currency: "text", photographerId: "uuid", uploadStatus: '"UploadStatus"', createdAt: "timestamp(3)", updatedAt: "timestamp(3)" }, photos);
		const readyPhotos = photos.filter((p) => p.uploadStatus === "READY");
		const publicPhotos = readyPhotos.filter((p) => p.status === "PUBLISHED" && p.visibility === "PUBLIC");
		log(`photos ${photos.length} (public ${publicPhotos.length})`);

		const photoCategories: Row[] = [];
		const photoTags: Row[] = [];
		const activeCategories = categories.filter((c) => c.status === "ACTIVE");

		for (const photo of readyPhotos) {
			for (const category of sample(activeCategories, int(1, 2))) {
				photoCategories.push({ photoId: photo.id, categoryId: category.id });
			}

			for (const tag of sample(tags, int(0, 4))) {
				photoTags.push({ photoId: photo.id, tagId: tag.id });
			}
		}

		await insert(db, "PhotoCategory", { photoId: "uuid", categoryId: "uuid" }, photoCategories);
		await insert(db, "PhotoTag", { photoId: "uuid", tagId: "uuid" }, photoTags);
		log(`photo categories ${photoCategories.length}, photo tags ${photoTags.length}`);

		// --- Public galleries ------------------------------------------------
		const galleries: Row[] = [];
		const galleryPhotos: Row[] = [];
		let galleryPosition = 0;

		for (let i = 0; i < scaled(300); i++) {
			const title = `${pick(PLACES)} ${phrase()}`;
			const status = weighted({ PUBLISHED: 8, DRAFT: 1, ARCHIVED: 1 });
			const id = randomUUID();
			galleries.push({ id, slug: `${slugify(title)}-${i}`, title, description: chance(0.8) ? sentence(20) : null, status, position: status === "PUBLISHED" && chance(0.8) ? galleryPosition++ : null, createdAt: daysAgo(900, 5), updatedAt: daysAgo(30) });

			sample(status === "PUBLISHED" ? publicPhotos : readyPhotos, int(20, 120)).forEach((photo, position) => {
				galleryPhotos.push({ galleryId: id, photoId: photo.id, position, isFeatured: chance(0.1), addedAt: daysAgo(500) });
			});
		}

		await insert(db, "Gallery", { id: "uuid", slug: "text", title: "text", description: "text", status: '"GalleryStatus"', position: "int4", createdAt: "timestamp(3)", updatedAt: "timestamp(3)" }, galleries);
		await insert(db, "GalleryPhoto", { galleryId: "uuid", photoId: "uuid", position: "int4", isFeatured: "bool", addedAt: "timestamp(3)" }, galleryPhotos);
		log(`galleries ${galleries.length}, entries ${galleryPhotos.length}`);

		// --- Client albums, favorites, purchases ----------------------------
		const albums: Row[] = [];
		const albumPhotos: Row[] = [];
		const albumTags: Row[] = [];
		const favorites: Row[] = [];
		const purchases: Row[] = [];
		const purchasePhotos: Row[] = [];
		const albumSamples: { id: string; clientId: string; photoIds: string[] }[] = [];

		for (let i = 0; i < scaled(2000); i++) {
			const client = pick(liveClients);
			const type = weighted({ WATERMARK: 4, PAID: 3, FREE: 3 });
			const status = weighted({ PUBLISHED: 6, DRAFT: 3, ARCHIVED: 1 });
			const id = randomUUID();
			const members = sample(readyPhotos, int(20, 200));
			const title = `${client.name} — ${phrase()}`;
			albums.push({
				id, clientId: client.id, slug: randomBytes(12).toString("hex"), title, description: chance(0.5) ? sentence(15) : null, type, status,
				accessCodeHash: status === "DRAFT" && chance(0.5) ? null : accessCodeHash, secretVersion: 1,
				priceCents: type === "PAID" ? int(200, 1500) * 100 : null, packPriceCents: type === "WATERMARK" ? int(50, 300) * 100 : null, packSize: type === "WATERMARK" ? pick([5, 10, 20]) : null,
				currency: "EUR", coverPhotoId: members[0].id, expiresAt: chance(0.3) ? daysAgo(-180, -10) : null, publishedAt: status === "DRAFT" ? null : daysAgo(400, 1),
				views: status === "DRAFT" ? 0 : int(0, 500), lastViewedAt: status === "DRAFT" ? null : daysAgo(60), createdAt: daysAgo(800, 2), updatedAt: daysAgo(30),
			});

			members.forEach((photo, position) => {
				albumPhotos.push({ albumId: id, photoId: photo.id, position, isPreview: type === "PAID" ? chance(0.3) : true, addedAt: daysAgo(400) });
			});

			for (const tag of sample(tags, int(0, 3))) {
				albumTags.push({ albumId: id, tagId: tag.id });
			}

			if (status !== "DRAFT") {
				for (const photo of sample(members, int(0, 30))) {
					favorites.push({ id: randomUUID(), clientId: client.id, albumId: id, photoId: photo.id, createdAt: daysAgo(300) });
				}
			}

			if (albumSamples.length < 600 && status !== "ARCHIVED") {
				albumSamples.push({ id, clientId: client.id as string, photoIds: members.slice(0, 15).map((p) => p.id as string) });
			}

			const purchaseCount = status === "DRAFT" ? 0 : weighted({ 1: 2, 2: 3, 4: 3, 6: 2, 10: 1 } as Record<string, number>);

			for (let p = 0; p < Number(purchaseCount); p++) {
				const scope = type === "PAID" ? weighted({ ALBUM: 3, PHOTO: 2, PACK: 1 }) : weighted({ PHOTO: 6, PACK: 3, ALBUM: 1 });
				const pStatus = weighted({ COMPLETED: 70, PENDING: 15, FAILED: 10, REFUNDED: 5 });
				const purchaseId = randomUUID();
				const items = scope === "PHOTO" ? sample(members, 1) : scope === "PACK" ? sample(members, int(5, 10)) : members;
				purchases.push({ id: purchaseId, clientId: client.id, scope, albumId: id, priceCents: int(10, 1500) * 100, currency: "EUR", status: pStatus, note: chance(0.2) ? sentence(8) : null, completedAt: pStatus === "PENDING" || pStatus === "FAILED" ? null : daysAgo(300), createdAt: daysAgo(400), updatedAt: daysAgo(100) });

				if (pStatus === "COMPLETED" || pStatus === "REFUNDED") {
					for (const photo of items) {
						purchasePhotos.push({ purchaseId, photoId: photo.id, addedAt: daysAgo(300) });
					}
				}
			}
		}

		await insert(db, "Album", { id: "uuid", clientId: "uuid", slug: "text", title: "text", description: "text", type: '"AlbumType"', status: '"AlbumStatus"', accessCodeHash: "text", secretVersion: "int4", priceCents: "int4", packPriceCents: "int4", packSize: "int4", currency: "text", coverPhotoId: "uuid", expiresAt: "timestamp(3)", publishedAt: "timestamp(3)", views: "int4", lastViewedAt: "timestamp(3)", createdAt: "timestamp(3)", updatedAt: "timestamp(3)" }, albums);
		await insert(db, "AlbumPhoto", { albumId: "uuid", photoId: "uuid", position: "int4", isPreview: "bool", addedAt: "timestamp(3)" }, albumPhotos);
		await insert(db, "AlbumTag", { albumId: "uuid", tagId: "uuid" }, albumTags);
		await insert(db, "Favorite", { id: "uuid", clientId: "uuid", albumId: "uuid", photoId: "uuid", createdAt: "timestamp(3)" }, favorites);
		await insert(db, "Purchase", { id: "uuid", clientId: "uuid", scope: '"PurchaseScope"', albumId: "uuid", priceCents: "int4", currency: "text", status: '"PurchaseStatus"', note: "text", completedAt: "timestamp(3)", createdAt: "timestamp(3)", updatedAt: "timestamp(3)" }, purchases);
		await insert(db, "PurchasePhoto", { purchaseId: "uuid", photoId: "uuid", addedAt: "timestamp(3)" }, purchasePhotos);
		log(`albums ${albums.length}, album photos ${albumPhotos.length}, favorites ${favorites.length}, purchases ${purchases.length}, purchase photos ${purchasePhotos.length}`);

		// --- Field Atlas -----------------------------------------------------
		const locations: Row[] = [];
		const locationCategories: Row[] = [];
		const locationPhotos: Row[] = [];

		for (let i = 0; i < scaled(200); i++) {
			const id = randomUUID();
			const name = `${pick(PLACES)} ${pick(NOUN)}`;
			const country = pick(COUNTRIES);
			const lat = 37 + rand() * 5;
			const lng = -9.5 + rand() * 3;
			const isArea = chance(0.15);
			const d = 0.02 + rand() * 0.05;
			const status = weighted({ PUBLISHED: 8, DRAFT: 1, ARCHIVED: 1 });
			const members = sample(publicPhotos, int(3, 12));
			locations.push({
				id, slug: `${slugify(name)}-${i}`, name, description: sentence(25), country, region: pick(PLACES), city: pick(PLACES),
				geometryKind: isArea ? "AREA" : "POINT", latitude: isArea ? null : lat, longitude: isArea ? null : lng,
				geoJson: isArea ? { type: "Polygon", coordinates: [[[lng, lat], [lng + d, lat], [lng + d, lat + d], [lng, lat + d], [lng, lat]]] } : null,
				whyInteresting: sentence(20), subjects: sentence(6), accessNotes: chance(0.6) ? sentence(12) : null, safetyNotes: chance(0.3) ? sentence(10) : null,
				status, coverPhotoId: members[0].id, authorId: pick(directoryUserIds), publishedAt: status === "PUBLISHED" ? daysAgo(400) : null, createdAt: daysAgo(500, 5), updatedAt: daysAgo(30),
			});

			for (const category of sample(activeCategories, int(1, 2))) {
				locationCategories.push({ locationId: id, categoryId: category.id });
			}

			members.forEach((photo, position) => {
				locationPhotos.push({ locationId: id, photoId: photo.id, caption: chance(0.5) ? sentence(6) : null, position });
			});
		}

		await insert(db, "AtlasLocation", { id: "uuid", slug: "text", name: "text", description: "text", country: "text", region: "text", city: "text", geometryKind: '"AtlasGeometryKind"', latitude: "float8", longitude: "float8", geoJson: "jsonb", whyInteresting: "text", subjects: "text", accessNotes: "text", safetyNotes: "text", status: '"AtlasLocationStatus"', coverPhotoId: "uuid", authorId: "uuid", publishedAt: "timestamp(3)", createdAt: "timestamp(3)", updatedAt: "timestamp(3)" }, locations);
		await insert(db, "AtlasLocationCategory", { locationId: "uuid", categoryId: "uuid" }, locationCategories);
		await insert(db, "AtlasLocationPhoto", { locationId: "uuid", photoId: "uuid", caption: "text", position: "int4" }, locationPhotos);
		log(`atlas locations ${locations.length}`);

		// --- Operational history ---------------------------------------------
		const audit: Row[] = [];
		const actions = ["auth.login", "photos.create", "photos.publish", "albums.publish", "purchase.complete", "clients.update", "service_requests.update", "galleries.set_photos"];

		for (let i = 0; i < scaled(50000); i++) {
			audit.push({ id: randomUUID(), actorId: pick(allStaffIds), action: pick(actions), resourceType: pick(["photo", "album", "client", "purchase", "gallery"]), resourceId: randomUUID(), result: weighted({ SUCCESS: 95, FAILURE: 3, DENIED: 2 }), metadata: { source: "seed" }, createdAt: daysAgo(900) });
		}

		await insert(db, "AuditLog", { id: "uuid", actorId: "uuid", action: "text", resourceType: "text", resourceId: "text", result: '"AuditResult"', metadata: "jsonb", createdAt: "timestamp(3)" }, audit);

		// 30 days of probe history, as production keeps with the default
		// retention. Read by GET /v1/system/status.
		const checks: Row[] = [];
		const components = ["DATABASE", "STORAGE", "PUBLIC_API", "PUBLIC_STORAGE"];

		for (let minute = 0; minute < 30 * 24 * 60; minute++) {
			const checkedAt = new Date(NOW - minute * 60_000);

			for (const component of components) {
				checks.push({ id: randomUUID(), component, status: chance(0.995) ? "UP" : "DEGRADED", latencyMs: int(2, 120), errorCode: null, checkedAt });
			}
		}

		await insert(db, "HealthCheck", { id: "uuid", component: '"HealthComponent"', status: '"HealthStatus"', latencyMs: "int4", errorCode: "text", checkedAt: "timestamp(3)" }, checks, 20000);

		const backups: Row[] = [];

		for (let day = 0; day < 30; day++) {
			const startedAt = new Date(NOW - day * DAY - 3600_000);
			backups.push({ id: randomUUID(), status: "SUCCEEDED", startedAt, finishedAt: new Date(startedAt.getTime() + 600_000), errorCode: null });
		}

		await insert(db, "BackupRun", { id: "uuid", status: '"BackupRunStatus"', startedAt: "timestamp(3)", finishedAt: "timestamp(3)", errorCode: "text" }, backups);
		log(`audit ${audit.length}, health checks ${checks.length}`);

		await db.query("VACUUM ANALYZE");
		log("vacuum analyze done");

		// --- Fixtures for k6 -------------------------------------------------
		const numbers = await db.query<{ number: number }>(
			`SELECT DISTINCT p.number FROM "Photo" p
			 JOIN "GalleryPhoto" gp ON gp."photoId" = p.id
			 JOIN "Gallery" g ON g.id = gp."galleryId" AND g.status = 'PUBLISHED'
			 WHERE p.status = 'PUBLISHED' AND p.visibility = 'PUBLIC'`,
		);
		const publicTags = tags.filter((t) => t.visibility === "PUBLIC" && t.status === "ACTIVE");

		const fixtures = {
			generatedAt: new Date().toISOString(),
			scale: SCALE,
			staff: { password: STAFF_PASSWORD, accounts: staffAccounts.map((a) => a.email) },
			albumAccessCode: ALBUM_ACCESS_CODE,
			inviteTokens,
			public: {
				gallerySlugs: galleries.filter((g) => g.status === "PUBLISHED").map((g) => g.slug),
				photoNumbers: sample(numbers.rows.map((r) => r.number), 10000),
				atlasSlugs: locations.filter((l) => l.status === "PUBLISHED").map((l) => l.slug),
				atlasCountries: [...new Set(locations.map((l) => l.country as string))],
				categorySlugs: activeCategories.map((c) => c.slug),
				tagSlugs: publicTags.map((t) => t.slug),
				serviceSlugs: services.map((s) => s.slug),
				searchWords: [...ADJ, ...NOUN, ...PLACES.map((p) => p.toLowerCase())],
			},
			ids: {
				clients: sample(liveClients.map((c) => c.id as string), 2000),
				photos: sample(readyPhotos.map((p) => p.id as string), 5000),
				albums: albumSamples.map((a) => a.id),
				galleries: galleries.map((g) => g.id),
				requests: sample(requests.map((r) => r.id as string), 3000),
				purchases: sample(purchases.map((p) => p.id as string), 2000),
				tags: tags.map((t) => t.id),
				categories: categories.map((c) => c.id),
				atlas: locations.map((l) => l.id),
				users: directoryUserIds,
				photographers,
				services: services.map((s) => s.id),
			},
			albumSamples,
		};

		await mkdir(DATA_DIR, { recursive: true });
		await writeFile(path.join(DATA_DIR, "fixtures.json"), JSON.stringify(fixtures));
		log(`fixtures written to ${path.relative(process.cwd(), path.join(DATA_DIR, "fixtures.json"))}`);
	}
	finally {
		db.release();
		await pool.end();
	}
}

await main();
