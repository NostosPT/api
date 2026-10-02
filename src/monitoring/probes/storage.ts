import type { StorageProbeResult } from "../../storage/index.js";
import { classifyLatency, measure } from "../timing.js";
import type { Clock, Probe } from "../types.js";

export interface StorageProbeOptions {
	component: "STORAGE" | "STORAGE_WRITE";
	// storage.ping or storage.writeRoundTrip; they enforce the timeout and
	// never throw, resolving to null when storage is not configured.
	run: (timeoutMs: number) => Promise<StorageProbeResult | null>;
	timeoutMs: number;
	slowMs: number;
	clock?: Clock;
}

export function createStorageProbe(options: StorageProbeOptions): Probe {
	const clock = options.clock ?? (() => new Date());

	return async () => {
		const checkedAt = clock();
		const { value: result, latencyMs } = await measure(() => options.run(options.timeoutMs));

		if (result === null) {
			return null;
		}

		if (!result.ok) {
			return { component: options.component, status: "DOWN", latencyMs: null, errorCode: result.errorCode, checkedAt };
		}

		return {
			component: options.component,
			status: classifyLatency(latencyMs, options.slowMs),
			latencyMs,
			errorCode: null,
			checkedAt,
		};
	};
}
