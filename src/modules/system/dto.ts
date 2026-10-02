import type { HealthComponent, HealthStatus } from "@prisma/client";

export interface UptimeDTO {
	// Percentage of checks not DOWN (DEGRADED counts as available), two
	// decimals; null when the window has no checks.
	last24h: number | null;
	last7d: number | null;
	last30d: number | null;
}

export interface ComponentStatusDTO {
	component: HealthComponent;
	label: string;
	// null until the component has been checked.
	status: HealthStatus | null;
	lastCheckedAt: string | null;
	latencyMs: number | null;
	// Sanitized code (timeout, http_503, expires_in_10d), never raw errors.
	errorCode: string | null;
	uptime: UptimeDTO;
}

export interface BackupStatusDTO {
	lastSucceededAt: string | null;
	lastRunStatus: "RUNNING" | "SUCCEEDED" | "FAILED" | null;
	lastRunStartedAt: string | null;
}

export interface SystemStatusDTO {
	generatedAt: string;
	monitoringEnabled: boolean;
	components: ComponentStatusDTO[];
	backup: BackupStatusDTO;
}

export function uptimePercent(counts: Partial<Record<HealthStatus, number>>): number | null {
	const up = counts.UP ?? 0;
	const degraded = counts.DEGRADED ?? 0;
	const total = up + degraded + (counts.DOWN ?? 0);

	if (total === 0) {
		return null;
	}

	return Math.round(((up + degraded) / total) * 10_000) / 100;
}
