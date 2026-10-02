import { describe, expect, it } from "vitest";
import { errorCodeOf } from "../errors.js";
import { createBackupProbe, type BackupRunSummary, type BackupState } from "./backup.js";
import { createDatabaseProbe } from "./database.js";
import { createHttpProbe } from "./http.js";
import { createStorageProbe } from "./storage.js";
import { createTlsProbe, type CertificateInfo, type InspectCertificate } from "./tls.js";

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

describe("errorCodeOf with fetch failures", () => {
	it("unwraps fetch's cause", () => {
		const error = Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("getaddrinfo ENOTFOUND api.example.com"), { code: "ENOTFOUND" }) });

		expect(errorCodeOf(error)).toBe("enotfound");
	});

	it("keeps TLS verification codes", () => {
		const error = Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("certificate has expired"), { code: "CERT_HAS_EXPIRED" }) });

		expect(errorCodeOf(error)).toBe("cert_has_expired");
	});
});

function fetchReturning(respond: () => Response | Promise<Response>): { fetchImpl: typeof fetch; calls: { url: string; init: RequestInit }[] } {
	const calls: { url: string; init: RequestInit }[] = [];
	const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
		calls.push({ url: String(url), init: init ?? {} });

		return respond();
	}) as unknown as typeof fetch;

	return { fetchImpl, calls };
}

describe("createHttpProbe", () => {
	const base = { component: "PUBLIC_API" as const, url: "https://api.example.com/v1/health", timeoutMs: 1_000, slowMs: 500, clock };

	it("reports UP for a direct 200 without following redirects", async () => {
		const { fetchImpl, calls } = fetchReturning(() => new Response("{\"status\":\"ok\"}", { status: 200 }));

		await expect(createHttpProbe({ ...base, fetchImpl })()).resolves.toMatchObject({ component: "PUBLIC_API", status: "UP", errorCode: null });
		expect(calls[0].url).toBe("https://api.example.com/v1/health");
		expect(calls[0].init.redirect).toBe("manual");
	});

	it("reports DEGRADED when the response is slow", async () => {
		const { fetchImpl } = fetchReturning(async () => {
			await delay(30);

			return new Response("ok", { status: 200 });
		});

		await expect(createHttpProbe({ ...base, slowMs: 5, fetchImpl })()).resolves.toMatchObject({ status: "DEGRADED" });
	});

	it.each([502, 503, 301, 404])("reports DOWN for HTTP %i", async (status) => {
		const { fetchImpl } = fetchReturning(() => new Response(null, { status }));

		await expect(createHttpProbe({ ...base, fetchImpl })()).resolves.toMatchObject({ status: "DOWN", errorCode: `http_${status}` });
	});

	it("reports DOWN with the network code when the request fails", async () => {
		const fetchImpl = (async () => {
			throw Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }) });
		}) as unknown as typeof fetch;

		await expect(createHttpProbe({ ...base, fetchImpl })()).resolves.toEqual({
			component: "PUBLIC_API",
			status: "DOWN",
			latencyMs: null,
			errorCode: "econnrefused",
			checkedAt: NOW,
		});
	});

	it("reports a timeout when the server does not answer in time", async () => {
		const fetchImpl = ((_url: string, init: RequestInit) => new Promise((_, reject) => {
			init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
		})) as unknown as typeof fetch;

		await expect(createHttpProbe({ ...base, timeoutMs: 10, fetchImpl })()).resolves.toMatchObject({ status: "DOWN", errorCode: "timeout" });
	});
});

describe("createTlsProbe", () => {
	const DAY = 24 * 60 * 60 * 1000;
	const base = { component: "PUBLIC_API_TLS" as const, url: "https://api.example.com", timeoutMs: 1_000, degradedDays: 14, downDays: 3, clock };

	function certificate(daysLeft: number, overrides: Partial<CertificateInfo> = {}): InspectCertificate {
		return async () => ({ authorized: true, authorizationError: null, validTo: new Date(NOW.getTime() + daysLeft * DAY), ...overrides });
	}

	it("skips plain-http URLs", async () => {
		await expect(createTlsProbe({ ...base, url: "http://api.example.com", inspect: certificate(90) })()).resolves.toBeNull();
	});

	it("inspects the URL's host on the default or explicit port", async () => {
		const targets: string[] = [];
		const inspect: InspectCertificate = async (host, port) => {
			targets.push(`${host}:${port}`);

			return certificate(90)(host, port, 0);
		};

		await createTlsProbe({ ...base, inspect })();
		await createTlsProbe({ ...base, url: "https://storage.example.com:8443", inspect })();

		expect(targets).toEqual(["api.example.com:443", "storage.example.com:8443"]);
	});

	it.each([
		[90, "UP", null],
		[14, "UP", null],
		[13, "DEGRADED", "expires_in_13d"],
		[3, "DEGRADED", "expires_in_3d"],
		[2, "DOWN", "expires_in_2d"],
	])("classifies %i days left as %s", async (daysLeft, status, errorCode) => {
		await expect(createTlsProbe({ ...base, inspect: certificate(daysLeft) })()).resolves.toMatchObject({ status, errorCode });
	});

	it("reports DOWN with the verification code for an untrusted certificate", async () => {
		const inspect = certificate(-1, { authorized: false, authorizationError: "CERT_HAS_EXPIRED" });

		await expect(createTlsProbe({ ...base, inspect })()).resolves.toMatchObject({ status: "DOWN", errorCode: "cert_has_expired" });
	});

	it("reports DOWN when the handshake fails", async () => {
		const inspect: InspectCertificate = async () => {
			throw Object.assign(new Error("connect ECONNREFUSED 1.2.3.4:443"), { code: "ECONNREFUSED" });
		};

		await expect(createTlsProbe({ ...base, inspect })()).resolves.toMatchObject({ status: "DOWN", errorCode: "econnrefused" });
	});
});

describe("createBackupProbe", () => {
	const HOUR = 60 * 60 * 1000;
	const base = { degradedHours: 26, downHours: 50, clock };

	function run(status: "SUCCEEDED" | "FAILED", hoursAgo: number, errorCode: string | null = null): BackupRunSummary {
		return { status, finishedAt: new Date(NOW.getTime() - hoursAgo * HOUR), errorCode };
	}

	function state(latestFinished: BackupRunSummary | null, latestSucceeded: BackupRunSummary | null): () => Promise<BackupState> {
		return async () => ({ latestFinished, latestSucceeded });
	}

	it.each([
		[2, "UP", null],
		[26, "UP", null],
		[27, "DEGRADED", "stale_27h"],
		[50, "DEGRADED", "stale_50h"],
		[51, "DOWN", "stale_51h"],
	])("classifies a success %i hours ago as %s", async (hoursAgo, status, errorCode) => {
		const success = run("SUCCEEDED", hoursAgo);

		await expect(createBackupProbe({ ...base, load: state(success, success) })()).resolves.toEqual({
			component: "BACKUP",
			status,
			latencyMs: null,
			errorCode,
			checkedAt: NOW,
		});
	});

	it("reports DOWN when the latest run failed, even after a recent success", async () => {
		const probe = createBackupProbe({ ...base, load: state(run("FAILED", 1, "exit_1"), run("SUCCEEDED", 25)) });

		await expect(probe()).resolves.toMatchObject({ status: "DOWN", errorCode: "backup_exit_1" });
	});

	it("sanitizes the stored error code", async () => {
		const probe = createBackupProbe({ ...base, load: state(run("FAILED", 1, "exit 1; DROP TABLE"), null) });

		await expect(probe()).resolves.toMatchObject({ status: "DOWN", errorCode: "backup_exit1droptable" });
	});

	it("reports DOWN when no backup has ever succeeded", async () => {
		await expect(createBackupProbe({ ...base, load: state(null, null) })()).resolves.toMatchObject({ status: "DOWN", errorCode: "no_backup" });
	});

	it("skips the run when the database cannot be read", async () => {
		const probe = createBackupProbe({
			...base,
			load: async () => {
				throw new Error("database down");
			},
		});

		await expect(probe()).resolves.toBeNull();
	});
});
