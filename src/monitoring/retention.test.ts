import { describe, expect, it } from "vitest";
import { createPruner } from "./retention.js";

describe("createPruner", () => {
	const now = new Date("2026-10-02T12:00:00.000Z");

	it("prunes everything older than the retention window", async () => {
		const cutoffs: Date[] = [];
		const prune = createPruner({
			retentionDays: 30,
			prune: async (cutoff) => {
				cutoffs.push(cutoff);

				return { checks: 10, backupRuns: 1 };
			},
			clock: () => now,
		});

		await prune();

		expect(cutoffs.map((cutoff) => cutoff.toISOString())).toEqual(["2026-09-02T12:00:00.000Z"]);
	});

	it("never throws when the database is unavailable", async () => {
		const prune = createPruner({
			retentionDays: 30,
			prune: async () => {
				throw new Error("database down");
			},
			clock: () => now,
		});

		await expect(prune()).resolves.toBeUndefined();
	});
});
