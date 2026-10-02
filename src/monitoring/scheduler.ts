import * as logger from "../logging/logger.js";

// Minimal interval runner (no dependency): each task runs once at start and
// then every interval, never overlapping itself (a run still in progress
// skips the next tick). Timers are unref'd so they never hold the process.
export class Scheduler {
	private readonly timers: NodeJS.Timeout[] = [];
	private readonly inFlight = new Map<string, Promise<void>>();
	private stopped = false;

	every(name: string, intervalMs: number, task: () => Promise<void>): void {
		const run = (): void => {
			if (this.stopped || this.inFlight.has(name)) {
				return;
			}

			const promise = task()
				.catch(() => {
					logger.error(`Scheduled task failed: ${name}`);
				})
				.finally(() => {
					this.inFlight.delete(name);
				});

			this.inFlight.set(name, promise);
		};

		const timer = setInterval(run, intervalMs);

		timer.unref();
		this.timers.push(timer);
		run();
	}

	// Stops future runs and waits for the ones in progress.
	async stop(): Promise<void> {
		this.stopped = true;

		for (const timer of this.timers) {
			clearInterval(timer);
		}

		await Promise.allSettled([...this.inFlight.values()]);
	}
}
