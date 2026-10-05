import { beforeEach, describe, expect, it } from "vitest";
import { createMockPrisma, isP2002, type MockPrisma } from "./prisma-mock.js";

let mock: MockPrisma;

function seedTags(): void {
	mock.tag.create({ data: { id: "a", slug: "a", name: "A" } });
	mock.tag.create({ data: { id: "b", slug: "b", name: "B" } });
}

function slugs(): string[] {
	return mock.tag.findMany({ orderBy: { slug: "asc" } }).map((row) => String(row.slug));
}

function catchError(fn: () => unknown): unknown {
	try {
		fn();
	}
	catch (error) {
		return error;
	}

	throw new Error("expected a throw");
}

beforeEach(() => {
	mock = createMockPrisma();
	seedTags();
});

describe("prisma mock writes", () => {
	it("leaves the row unchanged when an update violates a unique index", () => {
		const error = catchError(() => mock.tag.update({ where: { id: "b" }, data: { slug: "a", name: "Changed" } }));

		expect(isP2002(error)).toBe(true);
		expect(mock.tag.findUnique({ where: { id: "b" } })).toMatchObject({ slug: "b", name: "B" });
	});

	it("reverts every row of an updateMany that violates a unique index", () => {
		const error = catchError(() => mock.tag.updateMany({ data: { slug: "same" } }));

		expect(isP2002(error)).toBe(true);
		expect(slugs()).toEqual(["a", "b"]);
	});
});

describe("prisma mock transactions", () => {
	it("keeps writes when the callback succeeds", async () => {
		await mock.$transaction(async (tx) => {
			tx.tag.create({ data: { id: "c", slug: "c", name: "C" } });
			tx.tag.update({ where: { id: "a" }, data: { name: "A2" } });
		});

		expect(slugs()).toEqual(["a", "b", "c"]);
		expect(mock.tag.findUnique({ where: { id: "a" } })?.name).toBe("A2");
	});

	it("undoes creates, updates and deletes when the callback throws", async () => {
		const run = mock.$transaction(async (tx) => {
			tx.tag.create({ data: { id: "c", slug: "c", name: "C" } });
			tx.tag.update({ where: { id: "a" }, data: { slug: "a2", name: "A2" } });
			tx.tag.updateMany({ where: { id: "b" }, data: { name: "B2" } });
			tx.tag.delete({ where: { id: "b" } });
			tx.tag.deleteMany({ where: { id: "a" } });
			throw new Error("boom");
		});

		await expect(run).rejects.toThrow("boom");
		expect(mock.tag.findMany({ orderBy: { slug: "asc" } }).map((row) => [row.slug, row.name])).toEqual([
			["a", "A"],
			["b", "B"],
		]);
	});

	it("rolls back only its own writes, not ones made outside it meanwhile", async () => {
		let release: () => void = () => undefined;
		const paused = new Promise<void>((resolve) => {
			release = resolve;
		});

		const run = mock.$transaction(async (tx) => {
			tx.tag.update({ where: { id: "a" }, data: { name: "A2" } });
			await paused;
			throw new Error("boom");
		});

		mock.tag.create({ data: { id: "c", slug: "c", name: "C" } });
		mock.tag.update({ where: { id: "b" }, data: { name: "B2" } });
		release();

		await expect(run).rejects.toThrow("boom");
		expect(mock.tag.findUnique({ where: { id: "a" } })?.name).toBe("A");
		expect(mock.tag.findUnique({ where: { id: "b" } })?.name).toBe("B2");
		expect(slugs()).toEqual(["a", "b", "c"]);
	});
});
