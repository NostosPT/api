// In-memory Prisma stand-in for inject() tests. Implements exactly the
// operations repositories use (findUnique/findFirst/findMany/count/create/
// update/updateMany/delete/deleteMany) with equality, null, gt/lt/in/
// startsWith/contains (with insensitive mode)/not matching, OR/AND where
// clauses plus orderBy/skip/take. Unique violations mimic P2002 so
// repository mapping is exercised realistically. $queryRaw understands only
// the CodeCounter bump in src/db/sequentialCodes.ts. No PostgreSQL required.

interface P2002Error {
	code: "P2002";
}

function isP2002(error: unknown): error is P2002Error {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as { code: unknown }).code === "P2002"
	);
}

export { isP2002 };

type Scalar = string | number | boolean | Date | null | undefined;
type RecordRow = Record<string, Scalar>;

interface Operator {
	gt?: Scalar;
	lt?: Scalar;
	gte?: Scalar;
	lte?: Scalar;
	in?: Scalar[];
	startsWith?: string;
	contains?: string;
	mode?: "insensitive" | "default";
	not?: Scalar;
}

type Condition = Scalar | Operator;
// OR/AND combine sub-clauses: { OR: [{ a: 1 }, { b: { contains: "x" } }] }.
type WhereInput = Record<string, Condition | WhereInput[]>;

function isOperator(value: Condition): value is Operator {
	return typeof value === "object" && value !== null && !(value instanceof Date);
}

function compareValues(actual: Scalar, expected: Scalar): number {
	if (actual instanceof Date && expected instanceof Date) {
		return actual.getTime() - expected.getTime();
	}

	if (typeof actual === "string" && typeof expected === "string") {
		return actual < expected ? -1 : actual > expected ? 1 : 0;
	}

	if (typeof actual === "number" && typeof expected === "number") {
		return actual - expected;
	}

	return String(actual) === String(expected) ? 0 : -1;
}

function matchesCondition(actual: Scalar, condition: Condition): boolean {
	if (isOperator(condition)) {
		if (condition.gt !== undefined && compareValues(actual, condition.gt) <= 0) {
			return false;
		}

		if (condition.lt !== undefined && compareValues(actual, condition.lt) >= 0) {
			return false;
		}

		if (condition.gte !== undefined && compareValues(actual, condition.gte) < 0) {
			return false;
		}

		if (condition.lte !== undefined && compareValues(actual, condition.lte) > 0) {
			return false;
		}

		if (condition.in !== undefined && !condition.in.some((value) => compareValues(actual, value) === 0)) {
			return false;
		}

		if (
			condition.startsWith !== undefined &&
			!(typeof actual === "string" && actual.startsWith(condition.startsWith))
		) {
			return false;
		}

		if (condition.contains !== undefined) {
			if (typeof actual !== "string") {
				return false;
			}

			const insensitive = condition.mode === "insensitive";
			const haystack = insensitive ? actual.toLowerCase() : actual;
			const needle = insensitive ? condition.contains.toLowerCase() : condition.contains;

			if (!haystack.includes(needle)) {
				return false;
			}
		}

		if (condition.not !== undefined && compareValues(actual, condition.not) === 0) {
			return false;
		}

		return true;
	}

	if (condition === null) {
		// Unset mock fields behave like real NULL columns.
		return actual === null || actual === undefined;
	}

	return compareValues(actual, condition) === 0;
}

function matchesWhere(row: RecordRow, where?: WhereInput): boolean {
	if (!where) {
		return true;
	}

	return Object.entries(where).every(([field, condition]) => {
		if (field === "OR" && Array.isArray(condition)) {
			return condition.some((clause) => matchesWhere(row, clause));
		}

		if (field === "AND" && Array.isArray(condition)) {
			return condition.every((clause) => matchesWhere(row, clause));
		}

		if (Array.isArray(condition)) {
			return false;
		}

		return matchesCondition(row[field], condition);
	});
}

interface OrderClause {
	[field: string]: "asc" | "desc";
}

interface FindManyArgs {
	where?: WhereInput;
	orderBy?: OrderClause | OrderClause[];
	skip?: number;
	take?: number;
	select?: Record<string, boolean>;
	include?: Record<string, boolean | object>;
}

let idCounter = 0;

export function mockId(): string {
	idCounter += 1;

	// Must be a valid UUID so route param validation (IdParams pattern) passes.
	const hex = idCounter.toString(16).padStart(12, "0");

	return `00000000-0000-4000-8000-${hex}`;
}

export function resetMockIds(): void {
	idCounter = 0;
}

// Clears all rows in place so the mocked module instance stays current.
export function resetMock(mock: MockPrisma): void {
	mock.user.rows.length = 0;
	mock.session.rows.length = 0;
	mock.invite.rows.length = 0;
	mock.auditLog.rows.length = 0;
	mock.service.rows.length = 0;
	mock.serviceRequest.rows.length = 0;
	mock.client.rows.length = 0;
	mock.requestNote.rows.length = 0;
	mock.clientActivity.rows.length = 0;
	mock.tag.rows.length = 0;
	mock.category.rows.length = 0;
	mock.photo.rows.length = 0;
	mock.album.rows.length = 0;
	mock.albumPhoto.rows.length = 0;
	mock.favorite.rows.length = 0;
	mock.purchase.rows.length = 0;
	mock.atlasLocation.rows.length = 0;
	mock.atlasLocationCategory.rows.length = 0;
	mock.atlasLocationPhoto.rows.length = 0;
mock.gallery.rows.length = 0;
	mock.galleryPhoto.rows.length = 0;
	mock.photoCategory.rows.length = 0;
	mock.photoTag.rows.length = 0;
	mock.albumTag.rows.length = 0;
	mock.purchasePhoto.rows.length = 0;
	mock.codeCounter.rows.length = 0;
}

class MockModel {
	rows: RecordRow[] = [];
	uniqueFields: string[][];
	// Timestamp fields with @default(now()) in the schema. The mock fills
	// them exactly like the database would; models without them stay bare.
	defaultTimestamps: string[];
	// Nullable fields that should default to null when absent so null-checks
	// in DTO code distinguish "column is null" from "column was not provided".
	nullableFields: string[];
	// Integer columns with @default(autoincrement()); the mock fills the next
	// value from existing rows exactly like the sequence would.
	autoIncrementFields: string[];

	constructor(
		uniqueFields: string[][] = [],
		defaultTimestamps: string[] = ["createdAt", "updatedAt"],
		nullableFields: string[] = [],
		autoIncrementFields: string[] = [],
	) {
		this.uniqueFields = uniqueFields;
		this.defaultTimestamps = defaultTimestamps;
		this.nullableFields = nullableFields;
		this.autoIncrementFields = autoIncrementFields;
	}

	private checkUnique(row: RecordRow, exclude?: RecordRow): void {
		for (const fields of this.uniqueFields) {
			// Postgres unique indexes treat NULLs as distinct: a NULL value in
			// the new row can never violate a unique constraint.
			const hasNull = fields.some((field) => row[field] === null || row[field] === undefined);

			if (hasNull) {
				continue;
			}

			const clash = this.rows.find(
				(existing) =>
					existing !== exclude &&
					fields.every((field) => compareValues(existing[field], row[field]) === 0),
			);

			if (clash) {
				throw { code: "P2002" } as P2002Error;
			}
		}
	}

	findUnique(args: { where: WhereInput; select?: Record<string, boolean> }): RecordRow | null {
		const found = this.rows.find((row) => matchesWhere(row, args.where)) ?? null;

		if (found === null) {
			return null;
		}

		return this.project(found, args.select);
	}

	findFirst(args: {
		where?: WhereInput;
		orderBy?: OrderClause | OrderClause[];
		select?: Record<string, boolean>;
	}): RecordRow | null {
		const found = this.applyFindMany({ ...args }).at(0) ?? null;

		if (found === null) {
			return null;
		}

		return this.project(found, args.select);
	}

	findMany(args: FindManyArgs = {}): RecordRow[] {
		return this.applyFindMany(args);
	}

	private applyFindMany(args: FindManyArgs): RecordRow[] {
		let result = this.rows.filter((row) => matchesWhere(row, args.where));

		const orderClauses = args.orderBy === undefined ? [] : Array.isArray(args.orderBy) ? args.orderBy : [args.orderBy];

		for (const clause of orderClauses.reverse()) {
			const [field, direction] = Object.entries(clause)[0];
			const multiplier = direction === "desc" ? -1 : 1;
			result = [...result].sort((a, b) => compareValues(a[field], b[field]) * multiplier);
		}

		if (args.skip !== undefined) {
			result = result.slice(args.skip);
		}

		if (args.take !== undefined) {
			result = result.slice(0, args.take);
		}

		return result.map((row) => ({ ...row }));
	}

	count(args: { where?: WhereInput } = {}): number {
		return this.rows.filter((row) => matchesWhere(row, args.where)).length;
	}

	create(args: { data: RecordRow; select?: Record<string, boolean> }): RecordRow {
		const row: RecordRow = { ...args.data };

		if (row.id === undefined) {
			row.id = mockId();
		}

		for (const field of this.defaultTimestamps) {
			if (row[field] === undefined) {
				row[field] = new Date();
			}
		}

		// Default nullable fields that were not provided so null-checks in DTOs
		// behave consistently (undefined vs null must not differ for ternary logic).
		for (const field of this.nullableFields) {
			if (!(field in row)) {
				row[field] = null;
			}
		}

		for (const field of this.autoIncrementFields) {
			if (row[field] === undefined) {
				const max = this.rows.reduce(
					(highest, existing) => typeof existing[field] === "number" && existing[field] > highest
						? existing[field] as number
						: highest,
					0,
				);
				row[field] = max + 1;
			}
		}

		this.checkUnique(row);
		this.rows.push(row);

		return this.project(row, args.select);
	}

	update(args: { where?: WhereInput; data: RecordRow }): RecordRow {
		const row = this.rows.find((candidate) => matchesWhere(candidate, args.where));

		if (!row) {
			throw { code: "P2025" };
		}

		Object.assign(row, args.data);

		if ("updatedAt" in row) {
			row.updatedAt = new Date();
		}

		this.checkUnique(row, row);

		return { ...row };
	}

	updateMany(args: { where?: WhereInput; data: RecordRow }): { count: number } {
		let count = 0;

		for (const row of this.rows) {
			if (matchesWhere(row, args.where)) {
				Object.assign(row, args.data);
				count += 1;
			}
		}

		return { count };
	}

	delete(args: { where?: WhereInput }): RecordRow {
		const index = this.rows.findIndex((row) => matchesWhere(row, args.where));

		if (index === -1) {
			throw { code: "P2025" };
		}

		const [removed] = this.rows.splice(index, 1);

		return { ...removed };
	}

	deleteMany(args: { where?: WhereInput }): { count: number } {
		const before = this.rows.length;
		this.rows = this.rows.filter((row) => !matchesWhere(row, args.where));

		return { count: before - this.rows.length };
	}

	private project(row: RecordRow, select?: Record<string, boolean>): RecordRow {
		if (!select) {
			return { ...row };
		}

		const projected: RecordRow = {};

		for (const [field, include] of Object.entries(select)) {
			if (include) {
				projected[field] = row[field];
			}
		}

		return projected;
	}
}

const LATENT_METHODS = [
	"findUnique",
	"findFirst",
	"findMany",
	"count",
	"create",
	"update",
	"updateMany",
	"delete",
	"deleteMany",
] as const;

function nextTick(): Promise<void> {
	return new Promise((resolve) => setImmediate(resolve));
}

// Real queries take a round trip, so concurrent requests interleave between a
// read and the write that depends on it. The mock otherwise answers in the
// same tick, which hides races. While enabled, every model call and $queryRaw
// yields to the event loop before and after running; seed rows before
// enabling. Returns a function that restores the instant behaviour.
export function simulateLatency(mock: MockPrisma): () => void {
	const models = Object.values(mock).filter((value): value is MockModel => value instanceof MockModel);
	const queryRaw = mock.$queryRaw;

	for (const model of models) {
		for (const method of LATENT_METHODS) {
			const original = model[method].bind(model) as (...args: never[]) => unknown;

			Object.defineProperty(model, method, {
				configurable: true,
				value: async (...args: never[]) => {
					await nextTick();
					const result = original(...args);
					await nextTick();

					return result;
				},
			});
		}
	}

	mock.$queryRaw = async <T>(query: TemplateStringsArray, ...values: unknown[]): Promise<T> => {
		await nextTick();
		const result = await queryRaw<T>(query, ...values);
		await nextTick();

		return result;
	};

	return () => {
		for (const model of models) {
			for (const method of LATENT_METHODS) {
				delete (model as Partial<Record<(typeof LATENT_METHODS)[number], unknown>>)[method];
			}
		}

		mock.$queryRaw = queryRaw;
	};
}

export interface MockPrisma {
	user: MockModel;
	session: MockModel;
	invite: MockModel;
	auditLog: MockModel;
	service: MockModel;
	serviceRequest: MockModel;
	client: MockModel;
	requestNote: MockModel;
	clientActivity: MockModel;
	tag: MockModel;
	category: MockModel;
	photo: MockModel;
	album: MockModel;
	albumPhoto: MockModel;
	albumTag: MockModel;
	favorite: MockModel;
	purchase: MockModel;
	atlasLocation: MockModel;
	atlasLocationCategory: MockModel;
	atlasLocationPhoto: MockModel;
	gallery: MockModel;
	galleryPhoto: MockModel;
	photoCategory: MockModel;
	photoTag: MockModel;
	purchasePhoto: MockModel;
	codeCounter: MockModel;
	$queryRaw: <T>(query: TemplateStringsArray, ...values: unknown[]) => Promise<T>;
	$transaction: <T>(fn: (tx: MockPrisma) => Promise<T>) => Promise<T>;
}

export function createMockPrisma(): MockPrisma {
	const mock: MockPrisma = {
		user: new MockModel([["email"]], ["createdAt", "updatedAt"]),
		session: new MockModel([["tokenHash"]], ["createdAt"], ["revokedAt", "ipHash", "uaHash"]),
		invite: new MockModel([["tokenHash"]], ["createdAt"], ["acceptedAt", "invitedById"]),
		auditLog: new MockModel([], ["createdAt"], ["actorId", "metadata"]),
		service: new MockModel(
			[["slug"], ["name"], ["position"]],
			["createdAt", "updatedAt"],
			["description", "priceFromCents", "priceToCents"],
		),
		serviceRequest: new MockModel(
			[["reference"]],
			["createdAt", "updatedAt"],
			[
				"serviceId",
				"preferredDate",
				"location",
				"budgetMinCents",
				"budgetMaxCents",
				"estimateFromCents",
				"estimateToCents",
				"quoteCents",
				"quoteId",
				"assigneeId",
				"source",
				"lostReason",
			],
		),
		client: new MockModel(
			[["clientCode"], ["email"]],
			["createdAt", "updatedAt"],
			["phone", "company", "notes", "taxId", "address", "source", "lastContactAt", "deletedAt"],
		),
		requestNote: new MockModel([], ["createdAt"], ["authorId"]),
		clientActivity: new MockModel([], ["createdAt"], ["body", "href", "authorId"]),
		tag: new MockModel([["slug"], ["name"]], ["createdAt", "updatedAt"], ["description"]),
		category: new MockModel([["slug"], ["name"], ["position"]], ["createdAt", "updatedAt"], ["description"]),
		photo: new MockModel(
			[["number"], ["originalKey"]],
			["createdAt", "updatedAt"],
			[
				"title",
				"description",
				"displayKey",
				"thumbnailKey",
				"width",
				"height",
				"takenAt",
				"location",
				"photographerId",
				"priceCents",
			],
			["number"],
		),
		album: new MockModel(
			[["slug"]],
			["createdAt", "updatedAt"],
			[
				"description",
				"accessCodeHash",
				"priceCents",
				"packPriceCents",
				"packSize",
				"coverPhotoId",
				"expiresAt",
				"publishedAt",
				"lastViewedAt",
			],
		),
		albumPhoto: new MockModel([["albumId", "position"], ["albumId", "photoId"]], ["addedAt"]),
		favorite: new MockModel([["clientId", "albumId", "photoId"]], ["createdAt"]),
		purchase: new MockModel([], ["createdAt", "updatedAt"], ["note", "completedAt"]),
		atlasLocation: new MockModel(
			[["slug"]],
			["createdAt", "updatedAt"],
			[
				"description",
				"country",
				"region",
				"city",
				"latitude",
				"longitude",
				"geoJson",
				"whyInteresting",
				"subjects",
				"accessNotes",
				"safetyNotes",
				"coverPhotoId",
				"publishedAt",
				"authorId",
			],
		),
		atlasLocationCategory: new MockModel([["locationId", "categoryId"]], []),
		atlasLocationPhoto: new MockModel([["locationId", "photoId"], ["locationId", "position"]], ["addedAt"], ["caption"]),
		gallery: new MockModel([["slug"], ["position"]], ["createdAt", "updatedAt"], ["description", "position"]),
		galleryPhoto: new MockModel([["galleryId", "position"], ["galleryId", "photoId"]], ["addedAt"]),
		photoCategory: new MockModel([["photoId", "categoryId"]], []),
		photoTag: new MockModel([["photoId", "tagId"]], []),
		albumTag: new MockModel([["albumId", "tagId"]], []),
		purchasePhoto: new MockModel([["purchaseId", "photoId"]], ["addedAt"]),
		codeCounter: new MockModel([["scope", "year"]], []),
		// Mirrors INSERT ... ON CONFLICT DO UPDATE ... RETURNING: the bump runs
		// synchronously, so concurrent callers each get a distinct value just
		// like the row lock guarantees in PostgreSQL.
		$queryRaw: async function $queryRaw<T>(query: TemplateStringsArray, ...values: unknown[]): Promise<T> {
			const sql = query.join("?").replace(/\s+/g, " ").trim();

			if (!sql.startsWith('INSERT INTO "CodeCounter"')) {
				throw new Error(`prisma-mock: unsupported raw query: ${sql}`);
			}

			const [scope, year] = values as [string, number];
			const existing = mock.codeCounter.rows.find((row) => row.scope === scope && row.year === year);

			if (existing) {
				existing.value = (existing.value as number) + 1;

				return [{ value: existing.value }] as T;
			}

			// Pushed directly, not via create(), so the bump stays synchronous
			// even while simulateLatency() wraps the model methods.
			mock.codeCounter.rows.push({ scope, year, value: 1 });

			return [{ value: 1 }] as T;
		},
		// All models share one row store, so the callback receives the same mock.
		$transaction: async function $transaction<T>(fn: (tx: MockPrisma) => Promise<T>): Promise<T> {
			return fn(mock);
		},
	};

	return mock;
}
