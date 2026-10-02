import { describe, expect, it } from "vitest";
import { StateTracker, type Transition } from "./stateTracker.js";
import type { CheckResult, HealthComponent, HealthStatus } from "./types.js";

let minute = 0;

function check(status: HealthStatus, component: HealthComponent = "STORAGE", errorCode: string | null = status === "UP" ? null : "timeout"): CheckResult {
	minute += 1;

	return { component, status, latencyMs: null, errorCode, checkedAt: new Date(Date.UTC(2026, 9, 2, 12, minute)) };
}

function feed(tracker: StateTracker, statuses: HealthStatus[], component: HealthComponent = "STORAGE"): (Transition | null)[] {
	return statuses.map((status) => tracker.observe(check(status, component)));
}

function tracker(): StateTracker {
	return new StateTracker({ failureThreshold: 3, recoveryThreshold: 2 });
}

describe("StateTracker", () => {
	it("confirms a healthy start immediately, from unknown", () => {
		const subject = tracker();

		expect(subject.observe(check("UP"))).toMatchObject({ from: null, to: "UP" });
		expect(subject.current("STORAGE")).toBe("UP");
		expect(feed(subject, ["UP", "UP"])).toEqual([null, null]);
	});

	it("needs the failure threshold before confirming an outage", () => {
		const subject = tracker();

		feed(subject, ["UP"]);
		const results = feed(subject, ["DOWN", "DOWN", "DOWN"]);

		expect(results.slice(0, 2)).toEqual([null, null]);
		expect(results[2]).toMatchObject({ component: "STORAGE", from: "UP", to: "DOWN", errorCode: "timeout" });
		expect(subject.current("STORAGE")).toBe("DOWN");
	});

	it("reports when the streak started, not when it was confirmed", () => {
		const subject = tracker();

		feed(subject, ["UP"]);
		const first = check("DOWN");

		subject.observe(first);
		subject.observe(check("DOWN"));

		expect(subject.observe(check("DOWN"))?.since).toEqual(first.checkedAt);
	});

	it("needs the failure threshold when the process starts during an outage", () => {
		const subject = tracker();
		const results = feed(subject, ["DOWN", "DOWN", "DOWN"]);

		expect(results.slice(0, 2)).toEqual([null, null]);
		expect(results[2]).toMatchObject({ from: null, to: "DOWN" });
	});

	it("needs the recovery threshold before confirming recovery", () => {
		const subject = tracker();

		feed(subject, ["UP", "DOWN", "DOWN", "DOWN"]);
		const results = feed(subject, ["UP", "UP"]);

		expect(results[0]).toBeNull();
		expect(results[1]).toMatchObject({ from: "DOWN", to: "UP", errorCode: null });
	});

	it("ignores flapping that never completes a streak", () => {
		const subject = tracker();

		feed(subject, ["UP"]);

		expect(feed(subject, ["DOWN", "DOWN", "UP", "DOWN", "DOWN", "UP"]).every((result) => result === null)).toBe(true);
		expect(subject.current("STORAGE")).toBe("UP");
	});

	it("counts mixed DOWN and DEGRADED results as one worsening streak, confirming the latest", () => {
		const subject = tracker();

		feed(subject, ["UP"]);

		expect(feed(subject, ["DOWN", "DEGRADED", "DOWN"])[2]).toMatchObject({ from: "UP", to: "DOWN" });
	});

	it("escalates from DEGRADED to DOWN with the failure threshold", () => {
		const subject = tracker();

		feed(subject, ["UP", "DEGRADED", "DEGRADED", "DEGRADED"]);

		expect(subject.current("STORAGE")).toBe("DEGRADED");
		expect(feed(subject, ["DOWN", "DOWN", "DOWN"])[2]).toMatchObject({ from: "DEGRADED", to: "DOWN" });
	});

	it("improves from DOWN to DEGRADED with the recovery threshold", () => {
		const subject = tracker();

		feed(subject, ["UP", "DOWN", "DOWN", "DOWN"]);

		expect(feed(subject, ["DEGRADED", "DEGRADED"])[1]).toMatchObject({ from: "DOWN", to: "DEGRADED" });
	});

	it("resets the streak when the direction changes", () => {
		const subject = tracker();

		feed(subject, ["UP", "DEGRADED", "DEGRADED", "DEGRADED"]);

		// worse, better, worse, worse: never three worse in a row
		expect(feed(subject, ["DOWN", "UP", "DOWN", "DOWN"]).every((result) => result === null)).toBe(true);
		expect(subject.current("STORAGE")).toBe("DEGRADED");
	});

	it("tracks components independently", () => {
		const subject = tracker();

		feed(subject, ["UP"], "DATABASE");
		feed(subject, ["UP"], "STORAGE");
		feed(subject, ["DOWN", "DOWN", "DOWN"], "DATABASE");

		expect(subject.current("DATABASE")).toBe("DOWN");
		expect(subject.current("STORAGE")).toBe("UP");
		expect(subject.current("BACKUP")).toBeNull();
	});
});
