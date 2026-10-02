import "../test/env.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StoragePort } from "../storage/index.js";
import type { MonitoringConfig } from "../types/config.js";
import { buildProbeGroups, runProbe, type Pipeline, type ProbeDependencies } from "./monitor.js";
import { Scheduler } from "./scheduler.js";
import { StateTracker, type Transition } from "./stateTracker.js";
import type { CheckResult, HealthStatus } from "./types.js";

const monitoring: MonitoringConfig = {
	enabled: true,
	publicApiUrl: undefined,
	publicStorageUrl: undefined,
	retentionDays: 30,
	intervals: { database: 60, storage: 60, storageWrite: 3600, public: 60, tls: 21600, backup: 900 },
	failureThreshold: 3,
	recoveryThreshold: 2,
	timeoutMs: 5000,
	publicTimeoutMs: 10000,
	databaseSlowMs: 500,
	storageSlowMs: 1000,
	publicSlowMs: 2000,
	tlsDegradedDays: 14,
	tlsDownDays: 3,
	backupDegradedHours: 26,
	backupDownHours: 50,
};

function deps(overrides: Partial<ProbeDependencies> = {}): ProbeDependencies {
	return {
		pingDatabase: async () => undefined,
		storage: { ping: async () => ({ ok: true }), writeRoundTrip: async () => ({ ok: true }) } as unknown as StoragePort,
		loadBackupState: async () => ({ latestFinished: null, latestSucceeded: null }),
		...overrides,
	};
}

describe("buildProbeGroups", () => {
	it("schedules only internal probes when no public URL is configured", () => {
		const groups = buildProbeGroups(monitoring, deps());

		expect(groups.map((group) => [group.name, group.intervalSeconds, group.probes.map((probe) => probe.component)])).toEqual([
			["database", 60, ["DATABASE"]],
			["storage", 60, ["STORAGE"]],
			["storage-write", 3600, ["STORAGE_WRITE"]],
			["backup", 900, ["BACKUP"]],
		]);
	});

	it("adds public and TLS probes for each configured public URL", async () => {
		const urls: string[] = [];
		const hosts: string[] = [];
		const groups = buildProbeGroups(
			{ ...monitoring, publicApiUrl: "https://api.example.com", publicStorageUrl: "https://storage.example.com/" },
			deps({
				fetchImpl: (async (url: string) => {
					urls.push(String(url));

					return new Response("ok", { status: 200 });
				}) as unknown as typeof fetch,
				inspect: async (host) => {
					hosts.push(host);

					return { authorized: true, authorizationError: null, validTo: new Date(Date.now() + 90 * 86_400_000) };
				},
			}),
		);
		const publicGroup = groups.find((group) => group.name === "public");
		const tlsGroup = groups.find((group) => group.name === "tls");

		expect(publicGroup?.probes.map((probe) => probe.component)).toEqual(["PUBLIC_API", "PUBLIC_STORAGE"]);
		expect(tlsGroup?.probes.map((probe) => probe.component)).toEqual(["PUBLIC_API_TLS", "PUBLIC_STORAGE_TLS"]);
		expect(tlsGroup?.intervalSeconds).toBe(21600);

		for (const { probe } of [...(publicGroup?.probes ?? []), ...(tlsGroup?.probes ?? [])]) {
			await probe();
		}

		expect(urls).toEqual(["https://api.example.com/v1/health", "https://storage.example.com/healthz"]);
		expect(hosts).toEqual(["api.example.com", "storage.example.com"]);
	});
});

describe("runProbe", () => {
	function pipeline(): Pipeline & { recorded: CheckResult[]; notified: Transition[] } {
		const recorded: CheckResult[] = [];
		const notified: Transition[] = [];

		return {
			recorded,
			notified,
			recorder: { record: async (result) => { recorded.push(result); } },
			tracker: new StateTracker({ failureThreshold: 3, recoveryThreshold: 2 }),
			notifier: { notify: async (transition) => { notified.push(transition); } },
		};
	}

	function probeOf(status: HealthStatus): () => Promise<CheckResult> {
		return async () => ({ component: "DATABASE", status, latencyMs: null, errorCode: null, checkedAt: new Date() });
	}

	it("records every result and notifies only confirmed changes", async () => {
		const subject = pipeline();

		for (const status of ["UP", "DOWN", "DOWN", "DOWN", "DOWN"] as const) {
			await runProbe(probeOf(status), subject);
		}

		expect(subject.recorded).toHaveLength(5);
		expect(subject.notified.map((transition) => [transition.from, transition.to])).toEqual([[null, "UP"], ["UP", "DOWN"]]);
	});

	it("records nothing for skipped probes", async () => {
		const subject = pipeline();

		await runProbe(async () => null, subject);

		expect(subject.recorded).toEqual([]);
		expect(subject.notified).toEqual([]);
	});
});

describe("Scheduler", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("runs immediately and then on every interval", async () => {
		vi.useFakeTimers();
		const scheduler = new Scheduler();
		let runs = 0;

		scheduler.every("task", 1_000, async () => {
			runs += 1;
		});

		expect(runs).toBe(1);
		await vi.advanceTimersByTimeAsync(3_000);
		expect(runs).toBe(4);
		await scheduler.stop();
	});

	it("skips a tick while the previous run is still going", async () => {
		vi.useFakeTimers();
		const scheduler = new Scheduler();
		let started = 0;

		scheduler.every("slow", 1_000, () => {
			started += 1;

			return new Promise((resolve) => {
				setTimeout(resolve, 2_500);
			});
		});

		await vi.advanceTimersByTimeAsync(2_000);
		expect(started).toBe(1);
		await vi.advanceTimersByTimeAsync(1_000);
		expect(started).toBe(2);

		const stopping = scheduler.stop();

		await vi.advanceTimersByTimeAsync(2_500);
		await stopping;
	});

	it("keeps running after a task fails", async () => {
		vi.useFakeTimers();
		const scheduler = new Scheduler();
		let runs = 0;

		scheduler.every("flaky", 1_000, async () => {
			runs += 1;
			throw new Error("boom");
		});

		await vi.advanceTimersByTimeAsync(2_000);
		expect(runs).toBe(3);
		await scheduler.stop();
	});

	it("waits for in-flight runs on stop and never runs again", async () => {
		vi.useFakeTimers();
		const scheduler = new Scheduler();
		let finished = false;
		let runs = 0;

		scheduler.every("task", 1_000, async () => {
			runs += 1;
			await new Promise((resolve) => {
				setTimeout(resolve, 500);
			});
			finished = true;
		});

		const stopping = scheduler.stop();

		await vi.advanceTimersByTimeAsync(500);
		await stopping;
		expect(finished).toBe(true);

		await vi.advanceTimersByTimeAsync(5_000);
		expect(runs).toBe(1);
	});
});
