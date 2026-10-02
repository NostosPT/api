import { errorCodeOf } from "../errors.js";
import { classifyLatency, measure, withTimeout } from "../timing.js";
import type { Clock, Probe } from "../types.js";

export interface DatabaseProbeOptions {
	ping: () => Promise<unknown>;
	timeoutMs: number;
	slowMs: number;
	clock?: Clock;
}

export function createDatabaseProbe(options: DatabaseProbeOptions): Probe {
	const clock = options.clock ?? (() => new Date());

	return async () => {
		const checkedAt = clock();

		try {
			const { latencyMs } = await measure(() => withTimeout(options.ping(), options.timeoutMs));

			return {
				component: "DATABASE",
				status: classifyLatency(latencyMs, options.slowMs),
				latencyMs,
				errorCode: null,
				checkedAt,
			};
		}
		catch (error) {
			return { component: "DATABASE", status: "DOWN", latencyMs: null, errorCode: errorCodeOf(error), checkedAt };
		}
	};
}
