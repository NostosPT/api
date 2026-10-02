import * as logger from "../logging/logger.js";
import type { CheckResult } from "./types.js";

export const DEFAULT_BUFFER_CAPACITY = 1_000;

export type InsertChecks = (results: CheckResult[]) => Promise<void>;

// Persists check results, buffering them in memory while PostgreSQL is
// unavailable so an outage still shows up in the history (uptime %) once
// the database is back. Bounded: the oldest results are dropped first.
// Results buffered when the process exits are lost (stated limitation).
export class CheckRecorder {
	private readonly buffer: CheckResult[] = [];
	private flushing = false;
	private failing = false;
	private dropped = 0;

	constructor(
		private readonly insert: InsertChecks,
		private readonly capacity: number = DEFAULT_BUFFER_CAPACITY,
	) {}

	get pending(): number {
		return this.buffer.length;
	}

	async record(result: CheckResult): Promise<void> {
		this.buffer.push(result);
		this.trim();
		await this.flush();
	}

	// Writes everything buffered. A flush already in progress wins; results
	// added meanwhile go out with the next one. Never throws.
	async flush(): Promise<void> {
		if (this.flushing || this.buffer.length === 0) {
			return;
		}

		this.flushing = true;
		const batch = this.buffer.splice(0);

		try {
			await this.insert(batch);

			if (this.failing) {
				logger.info(`Health check history writes recovered (${batch.length} buffered results saved, ${this.dropped} dropped)`);
			}

			this.failing = false;
			this.dropped = 0;
		}
		catch {
			this.buffer.unshift(...batch);
			this.trim();

			if (!this.failing) {
				logger.warn("Health check history write failed; buffering results in memory");
			}

			this.failing = true;
		}
		finally {
			this.flushing = false;
		}
	}

	private trim(): void {
		const excess = this.buffer.length - this.capacity;

		if (excess > 0) {
			this.buffer.splice(0, excess);
			this.dropped += excess;
		}
	}
}
