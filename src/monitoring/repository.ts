import { prisma } from "../db/prisma.js";
import type { BackupRunSummary, BackupState } from "./probes/backup.js";

// Data access for health monitoring. The only module here that touches Prisma.

export async function pingDatabase(): Promise<void> {
	await prisma.$queryRaw`SELECT 1`;
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
