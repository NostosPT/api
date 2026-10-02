import * as logger from "../logging/logger.js";
import type { Clock } from "./types.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export const PRUNE_INTERVAL_MS = DAY_MS;

export interface PruneCounts {
	checks: number;
	backupRuns: number;
}

export interface PrunerOptions {
	retentionDays: number;
	prune: (cutoff: Date) => Promise<PruneCounts>;
	clock?: Clock;
}

// Deletes check history and backup runs older than HEALTH_RETENTION_DAYS.
// Failures (database down) are logged and retried on the next run.
export function createPruner(options: PrunerOptions): () => Promise<void> {
	const clock = options.clock ?? (() => new Date());

	return async () => {
		const cutoff = new Date(clock().getTime() - options.retentionDays * DAY_MS);

		try {
			const counts = await options.prune(cutoff);

			if (counts.checks > 0 || counts.backupRuns > 0) {
				logger.info(`Pruned health history before ${cutoff.toISOString()}: ${counts.checks} checks, ${counts.backupRuns} backup runs`);
			}
		}
		catch {
			logger.warn("Health history pruning failed; retrying on the next run");
		}
	};
}
