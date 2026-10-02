import { describe, expect, it } from "vitest";
import { errorCodeOf } from "../errors.js";
import { createDatabaseProbe } from "./database.js";
import { createStorageProbe } from "./storage.js";

const NOW = new Date("2026-10-02T12:00:00.000Z");
const clock = (): Date => NOW;

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

// Shape observed from Prisma 7 + @prisma/adapter-pg when PostgreSQL is down.
function prismaAdapterError(kind: string): Error {
	return Object.assign(new Error("Raw query failed. host 10.0.0.2 user nostos"), {
		name: "PrismaClientKnownRequestError",
		code: "P2010",
		meta: { driverAdapterError: { cause: { kind, host: "10.0.0.2", port: 5432, user: "nostos" } } },
	});
}

describe("errorCodeOf", () => {
	it.each([
		[prismaAdapterError("DatabaseNotReachable"), "database_not_reachable"],
		[prismaAdapterError("AuthenticationFailed"), "authentication_failed"],
		[Object.assign(new Error("x"), { code: "P1001" }), "prisma_P1001"],
		[Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }), "econnrefused"],
		[Object.assign(new Error("slow"), { name: "TimeoutError" }), "timeout"],
		[new Error("anything else"), "error"],
		["not an error", "error"],
	])("maps %s to %s", (error, expected) => {
		expect(errorCodeOf(error)).toBe(expected);
	});

	it("never leaks hosts or users from driver errors", () => {
		const code = errorCodeOf(prismaAdapterError("DatabaseNotReachable"));

		expect(code).not.toContain("10.0.0.2");
		expect(code).not.toContain("nostos");
	});
});

describe("createDatabaseProbe", () => {
	it("reports UP with latency when the ping answers quickly", async () => {
		const probe = createDatabaseProbe({ ping: async () => undefined, timeoutMs: 1_000, slowMs: 500, clock });

		const result = await probe();

		expect(result).toMatchObject({ component: "DATABASE", status: "UP", errorCode: null, checkedAt: NOW });
		expect(result?.latencyMs).toBeGreaterThanOrEqual(0);
	});

	it("reports DEGRADED when the ping is slower than the threshold", async () => {
		const probe = createDatabaseProbe({ ping: () => delay(30), timeoutMs: 1_000, slowMs: 5, clock });

		await expect(probe()).resolves.toMatchObject({ status: "DEGRADED", errorCode: null });
	});

	it("reports DOWN with a sanitized code when the ping fails", async () => {
		const probe = createDatabaseProbe({
			ping: async () => {
				throw prismaAdapterError("DatabaseNotReachable");
			},
			timeoutMs: 1_000,
			slowMs: 500,
			clock,
		});

		await expect(probe()).resolves.toEqual({
			component: "DATABASE",
			status: "DOWN",
			latencyMs: null,
			errorCode: "database_not_reachable",
			checkedAt: NOW,
		});
	});

	it("reports DOWN with a timeout code when the ping hangs", async () => {
		const probe = createDatabaseProbe({ ping: () => new Promise(() => undefined), timeoutMs: 10, slowMs: 5, clock });

		await expect(probe()).resolves.toMatchObject({ status: "DOWN", errorCode: "timeout" });
	});
});

describe("createStorageProbe", () => {
	it("skips the run when storage is not configured", async () => {
		const probe = createStorageProbe({ component: "STORAGE", run: async () => null, timeoutMs: 1_000, slowMs: 500, clock });

		await expect(probe()).resolves.toBeNull();
	});

	it("passes the timeout to the storage operation", async () => {
		const received: number[] = [];
		const probe = createStorageProbe({
			component: "STORAGE",
			run: async (timeoutMs) => {
				received.push(timeoutMs);

				return { ok: true };
			},
			timeoutMs: 1_234,
			slowMs: 500,
			clock,
		});

		await probe();

		expect(received).toEqual([1_234]);
	});

	it("reports UP, DEGRADED, and DOWN for the given component", async () => {
		const up = createStorageProbe({ component: "STORAGE_WRITE", run: async () => ({ ok: true }), timeoutMs: 1_000, slowMs: 500, clock });
		const slow = createStorageProbe({
			component: "STORAGE",
			run: async () => {
				await delay(30);

				return { ok: true };
			},
			timeoutMs: 1_000,
			slowMs: 5,
			clock,
		});
		const down = createStorageProbe({
			component: "STORAGE",
			run: async () => ({ ok: false, errorCode: "s3_AccessDenied" }),
			timeoutMs: 1_000,
			slowMs: 500,
			clock,
		});

		await expect(up()).resolves.toMatchObject({ component: "STORAGE_WRITE", status: "UP" });
		await expect(slow()).resolves.toMatchObject({ component: "STORAGE", status: "DEGRADED" });
		await expect(down()).resolves.toEqual({
			component: "STORAGE",
			status: "DOWN",
			latencyMs: null,
			errorCode: "s3_AccessDenied",
			checkedAt: NOW,
		});
	});
});
