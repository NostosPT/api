import "../../test/env.js";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import type { Role } from "@prisma/client";
import { createMockPrisma, resetMock, resetMockIds, type MockPrisma } from "../../test/prisma-mock.js";
import type { BackupState } from "../../monitoring/probes/backup.js";
import type { LatestBackupRun, StatusCount } from "../../monitoring/repository.js";
import type { CheckResult } from "../../monitoring/types.js";

const holder = { prisma: createMockPrisma() };

vi.mock("../../db/prisma.js", () => ({ prisma: holder.prisma }));

// Status reads are aggregate queries the in-memory Prisma mock does not
// implement; they are covered against PostgreSQL separately.
const reads = vi.hoisted(() => ({
	latest: [] as CheckResult[],
	countsBySince: ((): StatusCount[] => []) as (since: Date) => StatusCount[],
	backupState: { latestFinished: null, latestSucceeded: null } as BackupState,
	latestRun: null as LatestBackupRun | null,
}));

vi.mock("../../monitoring/repository.js", () => ({
	loadLatestChecks: async (components: string[]) => reads.latest.filter((check) => components.includes(check.component)),
	countChecksSince: async (since: Date) => reads.countsBySince(since),
	loadBackupState: async () => reads.backupState,
	loadLatestBackupRun: async () => reads.latestRun,
}));

import { createApp } from "../../app.js";
import { seedSession, seedUser, sessionCookie } from "../../test/helpers.js";
import { uptimePercent } from "./dto.js";

vi.setConfig({ testTimeout: 30_000 });

let app: FastifyInstance;
let mock: MockPrisma;
const cookies: Partial<Record<Role, string>> = {};

beforeAll(async () => {
	app = await createApp();
});

beforeEach(async () => {
	resetMockIds();
	resetMock(holder.prisma);
	mock = holder.prisma;

	for (const role of ["ADMIN", "PHOTOGRAPHER", "EDITOR", "ASSISTANT", "ACCOUNTANT"] as const) {
		const user = await seedUser(mock, { email: `${role.toLowerCase()}@nostos.photos`, role });

		cookies[role] = sessionCookie(await seedSession(mock, user.id));
	}

	reads.latest = [];
	reads.countsBySince = () => [];
	reads.backupState = { latestFinished: null, latestSucceeded: null };
	reads.latestRun = null;
});

function getStatus(cookie?: string): Promise<LightMyRequestResponse> {
	return app.inject({ method: "GET", url: "/v1/system/status", headers: cookie === undefined ? {} : { cookie } });
}

describe("GET /v1/system/status authorization", () => {
	it("rejects unauthenticated requests", async () => {
		const response = await getStatus();

		expect(response.statusCode).toBe(401);
		expect(response.json().error.code).toBe("AUTHENTICATION_ERROR");
	});

	it("rejects an invalid session", async () => {
		const response = await getStatus(sessionCookie("not-a-real-session-token"));

		expect(response.statusCode).toBe(401);
	});

	it.each(["PHOTOGRAPHER", "EDITOR", "ASSISTANT", "ACCOUNTANT"] as const)("forbids %s", async (role) => {
		const response = await getStatus(cookies[role]);

		expect(response.statusCode).toBe(403);
		expect(JSON.stringify(response.json())).not.toContain("DATABASE");
	});

	it("allows ADMIN", async () => {
		const response = await getStatus(cookies.ADMIN);

		expect(response.statusCode).toBe(200);
	});
});

describe("GET /v1/system/status payload", () => {
	it("lists configured components as unchecked before any history exists", async () => {
		const body = (await getStatus(cookies.ADMIN)).json();

		expect(body.monitoringEnabled).toBe(false);
		expect(body.components.map((component: { component: string }) => component.component)).toEqual([
			"DATABASE",
			"STORAGE",
			"STORAGE_WRITE",
			"BACKUP",
		]);
		expect(body.components[0]).toEqual({
			component: "DATABASE",
			label: "Database",
			status: null,
			lastCheckedAt: null,
			latencyMs: null,
			errorCode: null,
			uptime: { last24h: null, last7d: null, last30d: null },
		});
		expect(body.backup).toEqual({ lastSucceededAt: null, lastRunStatus: null, lastRunStartedAt: null });
	});

	it("reports the latest check, uptime per window, and backup state", async () => {
		const checkedAt = new Date("2026-10-02T11:59:00.000Z");
		const dayAgo = Date.now() - 25 * 60 * 60 * 1000;

		reads.latest = [{ component: "STORAGE", status: "DOWN", latencyMs: null, errorCode: "timeout", checkedAt }];
		// 24h window: 3 UP + 1 DOWN. Longer windows add older UP checks.
		reads.countsBySince = (since) => [
			{ component: "STORAGE", status: "UP", count: since.getTime() < dayAgo ? 99 : 3 },
			{ component: "STORAGE", status: "DOWN", count: 1 },
		];
		reads.backupState = {
			latestFinished: { status: "SUCCEEDED", finishedAt: new Date("2026-10-02T03:10:00.000Z"), errorCode: null },
			latestSucceeded: { status: "SUCCEEDED", finishedAt: new Date("2026-10-02T03:10:00.000Z"), errorCode: null },
		};
		reads.latestRun = { status: "SUCCEEDED", startedAt: new Date("2026-10-02T03:00:00.000Z"), finishedAt: new Date("2026-10-02T03:10:00.000Z") };

		const body = (await getStatus(cookies.ADMIN)).json();
		const storage = body.components.find((component: { component: string }) => component.component === "STORAGE");

		expect(storage).toEqual({
			component: "STORAGE",
			label: "Storage",
			status: "DOWN",
			lastCheckedAt: "2026-10-02T11:59:00.000Z",
			latencyMs: null,
			errorCode: "timeout",
			uptime: { last24h: 75, last7d: 99, last30d: 99 },
		});
		expect(body.backup).toEqual({
			lastSucceededAt: "2026-10-02T03:10:00.000Z",
			lastRunStatus: "SUCCEEDED",
			lastRunStartedAt: "2026-10-02T03:00:00.000Z",
		});
	});

	it("keeps showing components that still have history after being disabled", async () => {
		reads.countsBySince = () => [{ component: "PUBLIC_API", status: "UP", count: 10 }];

		const body = (await getStatus(cookies.ADMIN)).json();

		expect(body.components.map((component: { component: string }) => component.component)).toContain("PUBLIC_API");
	});
});

describe("uptimePercent", () => {
	it("counts DEGRADED as available and rounds to two decimals", () => {
		expect(uptimePercent({ UP: 1, DEGRADED: 1, DOWN: 1 })).toBe(66.67);
		expect(uptimePercent({ DEGRADED: 5 })).toBe(100);
		expect(uptimePercent({ DOWN: 2 })).toBe(0);
		expect(uptimePercent({})).toBeNull();
	});
});
