import { prisma } from "../db/prisma.js";
import type { BackupRunSummary, BackupState } from "./probes/backup.js";
import type { PruneCounts } from "./retention.js";
import type { CheckResult, HealthComponent, HealthStatus } from "./types.js";

// Data access for health monitoring. The only module here that touches Prisma.

export async function pingDatabase(): Promise<void> {
	await prisma.$queryRaw`SELECT 1`;
}

export async function insertHealthChecks(results: CheckResult[]): Promise<void> {
	await prisma.healthCheck.createMany({
		data: results.map((result) => ({
			component: result.component,
			status: result.status,
			latencyMs: result.latencyMs,
			errorCode: result.errorCode,
			checkedAt: result.checkedAt,
		})),
	});
}

export async function listActiveAdminEmails(): Promise<string[]> {
	const admins = await prisma.user.findMany({
		where: { role: "ADMIN", status: "ACTIVE" },
		select: { email: true },
	});

	return admins.map((admin) => admin.email);
}

const backupRunSelect = { status: true, startedAt: true, finishedAt: true, errorCode: true } as const;

function toSummary(row: { status: string; startedAt: Date; finishedAt: Date | null; errorCode: string | null } | null): BackupRunSummary | null {
	if (row === null || (row.status !== "SUCCEEDED" && row.status !== "FAILED")) {
		return null;
	}

	return { status: row.status, finishedAt: row.finishedAt ?? row.startedAt, errorCode: row.errorCode };
}

export async function loadBackupState(): Promise<BackupState> {
	const [latestFinished, latestSucceeded] = await Promise.all([
		prisma.backupRun.findFirst({
			where: { status: { in: ["SUCCEEDED", "FAILED"] } },
			orderBy: { startedAt: "desc" },
			select: backupRunSelect,
		}),
		prisma.backupRun.findFirst({
			where: { status: "SUCCEEDED" },
			orderBy: { startedAt: "desc" },
			select: backupRunSelect,
		}),
	]);

	return { latestFinished: toSummary(latestFinished), latestSucceeded: toSummary(latestSucceeded) };
}

// The latest successful backup run is always kept, so its age stays known
// even when backups have been failing for longer than the retention window.
export async function pruneHealthHistory(cutoff: Date): Promise<PruneCounts> {
	const keep = await prisma.backupRun.findFirst({
		where: { status: "SUCCEEDED" },
		orderBy: { startedAt: "desc" },
		select: { id: true },
	});

	const [checks, backupRuns] = await prisma.$transaction([
		prisma.healthCheck.deleteMany({ where: { checkedAt: { lt: cutoff } } }),
		prisma.backupRun.deleteMany({
			where: { startedAt: { lt: cutoff }, ...(keep === null ? {} : { id: { not: keep.id } }) },
		}),
	]);

	return { checks: checks.count, backupRuns: backupRuns.count };
}

// --- Status reads (GET /v1/system/status) ---------------------------------

export async function loadLatestChecks(components: HealthComponent[]): Promise<CheckResult[]> {
	const rows = await Promise.all(components.map((component) => prisma.healthCheck.findFirst({
		where: { component },
		orderBy: { checkedAt: "desc" },
		select: { component: true, status: true, latencyMs: true, errorCode: true, checkedAt: true },
	})));

	return rows.filter((row) => row !== null);
}

export interface StatusCount {
	component: HealthComponent;
	status: HealthStatus;
	count: number;
}

export async function countChecksSince(since: Date): Promise<StatusCount[]> {
	const groups = await prisma.healthCheck.groupBy({
		by: ["component", "status"],
		where: { checkedAt: { gte: since } },
		_count: { _all: true },
	});

	return groups.map((group) => ({ component: group.component, status: group.status, count: group._count._all }));
}

export interface LatestBackupRun {
	status: "RUNNING" | "SUCCEEDED" | "FAILED";
	startedAt: Date;
	finishedAt: Date | null;
}

export async function loadLatestBackupRun(): Promise<LatestBackupRun | null> {
	return prisma.backupRun.findFirst({
		orderBy: { startedAt: "desc" },
		select: { status: true, startedAt: true, finishedAt: true },
	});
}
