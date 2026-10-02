import { describe, expect, it } from "vitest";
import { CheckRecorder } from "./recorder.js";
import type { CheckResult } from "./types.js";

function result(minute: number): CheckResult {
	return {
		component: "DATABASE",
		status: "DOWN",
		latencyMs: null,
		errorCode: "database_not_reachable",
		checkedAt: new Date(Date.UTC(2026, 9, 2, 12, minute)),
	};
}

function store(): { saved: CheckResult[]; up: boolean; insert: (results: CheckResult[]) => Promise<void> } {
	const state = {
		saved: [] as CheckResult[],
		up: true,
		insert: async (results: CheckResult[]) => {
			if (!state.up) {
				throw new Error("database down");
			}

			state.saved.push(...results);
		},
	};

	return state;
}

describe("CheckRecorder", () => {
	it("writes results straight through while the database is up", async () => {
		const db = store();
		const recorder = new CheckRecorder(db.insert);

		await recorder.record(result(0));
		await recorder.record(result(1));

		expect(db.saved.map((saved) => saved.checkedAt.getUTCMinutes())).toEqual([0, 1]);
		expect(recorder.pending).toBe(0);
	});

	it("buffers during an outage and flushes in order once the database is back", async () => {
		const db = store();
		const recorder = new CheckRecorder(db.insert);

		db.up = false;
		await recorder.record(result(0));
		await recorder.record(result(1));

		expect(db.saved).toEqual([]);
		expect(recorder.pending).toBe(2);

		db.up = true;
		await recorder.record(result(2));

		expect(db.saved.map((saved) => saved.checkedAt.getUTCMinutes())).toEqual([0, 1, 2]);
		expect(recorder.pending).toBe(0);
	});

	it("keeps original probe times for late writes", async () => {
		const db = store();
		const recorder = new CheckRecorder(db.insert);

		db.up = false;
		await recorder.record(result(5));
		db.up = true;
		await recorder.flush();

		expect(db.saved[0].checkedAt.toISOString()).toBe("2026-10-02T12:05:00.000Z");
	});

	it("drops the oldest results beyond capacity", async () => {
		const db = store();
		const recorder = new CheckRecorder(db.insert, 3);

		db.up = false;

		for (let minute = 0; minute < 5; minute += 1) {
			await recorder.record(result(minute));
		}

		expect(recorder.pending).toBe(3);

		db.up = true;
		await recorder.flush();

		expect(db.saved.map((saved) => saved.checkedAt.getUTCMinutes())).toEqual([2, 3, 4]);
	});

	it("does not lose results recorded while a flush is in flight", async () => {
		const saved: CheckResult[] = [];
		let release: () => void = () => undefined;
		let calls = 0;
		const recorder = new CheckRecorder(async (results) => {
			calls += 1;

			if (calls === 1) {
				await new Promise<void>((resolve) => {
					release = resolve;
				});
			}

			saved.push(...results);
		});

		const first = recorder.record(result(0));

		await recorder.record(result(1));
		release();
		await first;
		await recorder.flush();

		expect(saved.map((entry) => entry.checkedAt.getUTCMinutes())).toEqual([0, 1]);
	});

	it("never throws when the write fails", async () => {
		const recorder = new CheckRecorder(async () => {
			throw new Error("database down");
		});

		await expect(recorder.record(result(0))).resolves.toBeUndefined();
		await expect(recorder.flush()).resolves.toBeUndefined();
	});
});
