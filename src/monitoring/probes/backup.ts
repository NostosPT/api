import type { Clock, HealthStatus, Probe } from "../types.js";

const HOUR_MS = 60 * 60 * 1000;

export interface BackupRunSummary {
	status: "SUCCEEDED" | "FAILED";
	finishedAt: Date;
	errorCode: string | null;
}

export interface BackupState {
	// Most recent run that finished, whatever its outcome.
	latestFinished: BackupRunSummary | null;
	latestSucceeded: BackupRunSummary | null;
}

export interface BackupProbeOptions {
	load: () => Promise<BackupState>;
	degradedHours: number;
	downHours: number;
	clock?: Clock;
}

function sanitize(code: string | null): string {
	const safe = (code ?? "").replace(/[^a-z0-9_]/gi, "").slice(0, 32).toLowerCase();

	return safe ? `backup_${safe}` : "backup_failed";
}

// Judges the off-site backup from the rows backup.sh writes. When the
// database cannot be read, the run is skipped (null): the DATABASE component
// already reports that outage, so one cause never alerts twice.
export function createBackupProbe(options: BackupProbeOptions): Probe {
	const clock = options.clock ?? (() => new Date());

	return async () => {
		const checkedAt = clock();
		let state: BackupState;

		try {
			state = await options.load();
		}
		catch {
			return null;
		}

		if (state.latestFinished?.status === "FAILED") {
			return { component: "BACKUP", status: "DOWN", latencyMs: null, errorCode: sanitize(state.latestFinished.errorCode), checkedAt };
		}

		if (state.latestSucceeded === null) {
			return { component: "BACKUP", status: "DOWN", latencyMs: null, errorCode: "no_backup", checkedAt };
		}

		const ageHours = Math.floor((checkedAt.getTime() - state.latestSucceeded.finishedAt.getTime()) / HOUR_MS);
		let status: HealthStatus = "UP";

		if (ageHours > options.downHours) {
			status = "DOWN";
		}
		else if (ageHours > options.degradedHours) {
			status = "DEGRADED";
		}

		return {
			component: "BACKUP",
			status,
			latencyMs: null,
			errorCode: status === "UP" ? null : `stale_${ageHours}h`,
			checkedAt,
		};
	};
}
