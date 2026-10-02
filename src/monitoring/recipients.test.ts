import { describe, expect, it } from "vitest";
import { RecipientCache } from "./recipients.js";

function source(initial: string[]): { emails: string[]; up: boolean; loads: number; load: () => Promise<string[]> } {
	const state = {
		emails: initial,
		up: true,
		loads: 0,
		load: async () => {
			state.loads += 1;

			if (!state.up) {
				throw new Error("database down");
			}

			return state.emails;
		},
	};

	return state;
}

describe("RecipientCache", () => {
	it("loads, normalizes, and deduplicates admin emails", async () => {
		const db = source(["Admin@Example.com", "admin@example.com", "ops@example.com"]);
		const cache = new RecipientCache(db.load, []);

		await expect(cache.get()).resolves.toEqual(["admin@example.com", "ops@example.com"]);
	});

	it("serves the cached list while the database is down", async () => {
		let now = 0;
		const db = source(["admin@example.com"]);
		const cache = new RecipientCache(db.load, ["fallback@example.com"], 1_000, () => now);

		await cache.refresh();
		db.up = false;
		now = 5_000;

		await expect(cache.get()).resolves.toEqual(["admin@example.com"]);
		expect(db.loads).toBe(2);
	});

	it("uses the fallback when nothing was ever cached", async () => {
		const db = source([]);
		const cache = new RecipientCache(db.load, ["fallback@example.com"]);

		db.up = false;

		await expect(cache.get()).resolves.toEqual(["fallback@example.com"]);
	});

	it("uses the fallback when there is no active admin", async () => {
		const cache = new RecipientCache(source([]).load, ["fallback@example.com"]);

		await expect(cache.get()).resolves.toEqual(["fallback@example.com"]);
	});

	it("returns an empty list when neither admins nor a fallback exist", async () => {
		const db = source([]);
		const cache = new RecipientCache(db.load, []);

		db.up = false;

		await expect(cache.get()).resolves.toEqual([]);
	});

	it("does not reload more often than the refresh interval", async () => {
		let now = 0;
		const db = source(["admin@example.com"]);
		const cache = new RecipientCache(db.load, [], 1_000, () => now);

		await cache.get();
		now = 500;
		await cache.get();

		expect(db.loads).toBe(1);

		now = 1_000;
		await cache.get();

		expect(db.loads).toBe(2);
	});

	it("picks up admin changes on refresh", async () => {
		const db = source(["old@example.com"]);
		const cache = new RecipientCache(db.load, []);

		await cache.refresh();
		db.emails = ["new@example.com"];
		await cache.refresh();

		await expect(cache.get()).resolves.toEqual(["new@example.com"]);
	});
});
