import { prisma } from "./prisma.js";

// Per-year business codes: CLI-2026-001 for clients, REQ-2026-031 for service
// requests. Numbers come from the CodeCounter table, bumped by a single
// INSERT ... ON CONFLICT DO UPDATE ... RETURNING: the row lock serializes
// concurrent callers, so each one gets a distinct number, and the value is an
// integer, so ordering never depends on how codes sort as text.
//
// Like a PostgreSQL sequence, numbers are not gap-free: a number allocated for
// an insert that then fails is not reused.

export type CodeScope = "CLIENT" | "SERVICE_REQUEST";

const PREFIXES: Record<CodeScope, string> = {
	CLIENT: "CLI",
	SERVICE_REQUEST: "REQ",
};

// Retries cover codes inserted behind the counter's back (e.g. by an instance
// still running the old generator during a deploy). Each retry draws a fresh
// number, so a handful is plenty; anything beyond that is a real conflict.
const MAX_ATTEMPTS = 5;

// Three-digit minimum keeps existing codes valid; larger numbers just grow.
export function formatCode(scope: CodeScope, year: number, value: number): string {
	return `${PREFIXES[scope]}-${year}-${value.toString().padStart(3, "0")}`;
}

export async function allocateCode(scope: CodeScope, now: Date = new Date()): Promise<string> {
	const year = now.getFullYear();
	const rows = await prisma.$queryRaw<{ value: number }[]>`
		INSERT INTO "CodeCounter" ("scope", "year", "value")
		VALUES (${scope}, ${year}, 1)
		ON CONFLICT ("scope", "year") DO UPDATE SET "value" = "CodeCounter"."value" + 1
		RETURNING "value"
	`;

	return formatCode(scope, year, rows[0].value);
}

function isUniqueViolation(error: unknown): boolean {
	return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

async function codeTaken(scope: CodeScope, code: string): Promise<boolean> {
	const row = scope === "CLIENT"
		? await prisma.client.findUnique({ where: { clientCode: code }, select: { id: true } })
		: await prisma.serviceRequest.findUnique({ where: { reference: code }, select: { id: true } });

	return row !== null;
}

// Runs insert with a freshly allocated code. A unique violation is retried with
// the next number only when the code itself is taken; a violation on another
// column (e.g. a duplicate client email) propagates unchanged, as does the last
// violation once MAX_ATTEMPTS is reached.
export async function insertWithCode<T>(scope: CodeScope, insert: (code: string) => Promise<T>): Promise<T> {
	for (let attempt = 1; ; attempt += 1) {
		const code = await allocateCode(scope);

		try {
			return await insert(code);
		}
		catch (error) {
			if (attempt >= MAX_ATTEMPTS || !isUniqueViolation(error) || !(await codeTaken(scope, code))) {
				throw error;
			}
		}
	}
}
