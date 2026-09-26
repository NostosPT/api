// In-memory Prisma stand-in for inject() tests. Implements exactly the
// operations repositories use (findUnique/findFirst/findMany/count/create/
// update/updateMany/delete/deleteMany) with equality, null, gt/lt/in matching
// plus orderBy/skip/take. Unique violations mimic P2002 so repository mapping
// is exercised realistically. No PostgreSQL required.

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
}

type Condition = Scalar | Operator;

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

		return true;
	}

	if (condition === null) {
		// Unset mock fields behave like real NULL columns.
		return actual === null || actual === undefined;
	}

	return compareValues(actual, condition) === 0;
}

function matchesWhere(row: RecordRow, where?: Record<string, Condition>): boolean {
	if (!where) {
		return true;
	}

	return Object.entries(where).every(([field, condition]) => matchesCondition(row[field], condition));
}

interface OrderClause {
	[field: string]: "asc" | "desc";
}

interface FindManyArgs {
	where?: Record<string, Condition>;
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

	constructor(
		uniqueFields: string[][] = [],
		defaultTimestamps: string[] = ["createdAt", "updatedAt"],
		nullableFields: string[] = [],
	) {
		this.uniqueFields = uniqueFields;
		this.defaultTimestamps = defaultTimestamps;
		this.nullableFields = nullableFields;
	}

	private checkUnique(row: RecordRow, exclude?: RecordRow): void {
		for (const fields of this.uniqueFields) {
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

	findUnique(args: { where: Record<string, Condition>; select?: Record<string, boolean> }): RecordRow | null {
		const found = this.rows.find((row) => matchesWhere(row, args.where)) ?? null;

		if (found === null) {
			return null;
		}

		return this.project(found, args.select);
	}

	findFirst(args: {
		where?: Record<string, Condition>;
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

	count(args: { where?: Record<string, Condition> } = {}): number {
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

		this.checkUnique(row);
		this.rows.push(row);

		return this.project(row, args.select);
	}

	update(args: { where: Record<string, Condition>; data: RecordRow }): RecordRow {
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

	updateMany(args: { where?: Record<string, Condition>; data: RecordRow }): { count: number } {
		let count = 0;

		for (const row of this.rows) {
			if (matchesWhere(row, args.where)) {
				Object.assign(row, args.data);
				count += 1;
			}
		}

		return { count };
	}

	delete(args: { where: Record<string, Condition> }): RecordRow {
		const index = this.rows.findIndex((row) => matchesWhere(row, args.where));

		if (index === -1) {
			throw { code: "P2025" };
		}

		const [removed] = this.rows.splice(index, 1);

		return { ...removed };
	}

	deleteMany(args: { where?: Record<string, Condition> }): { count: number } {
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

export interface MockPrisma {
	user: MockModel;
	session: MockModel;
	invite: MockModel;
	auditLog: MockModel;
}

export function createMockPrisma(): MockPrisma {
	return {
		user: new MockModel([["email"]], ["createdAt", "updatedAt"]),
		session: new MockModel([["tokenHash"]], ["createdAt"], ["revokedAt", "ipHash", "uaHash"]),
		invite: new MockModel([["tokenHash"]], ["createdAt"], ["acceptedAt", "invitedById"]),
		auditLog: new MockModel([], ["createdAt"], ["actorId", "metadata"]),
	};
}
