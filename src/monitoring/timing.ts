import { performance } from "node:perf_hooks";
import type { HealthStatus } from "./types.js";

export class ProbeTimeoutError extends Error {
	public override readonly name = "TimeoutError";

	constructor() {
		super("Probe timed out");
	}
}

// Rejects with ProbeTimeoutError after `ms`; the timer never outlives the race.
export async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
	let timer: NodeJS.Timeout | undefined;

	try {
		return await Promise.race([
			promise,
			new Promise<never>((_, reject) => {
				timer = setTimeout(() => reject(new ProbeTimeoutError()), ms);
			}),
		]);
	}
	finally {
		clearTimeout(timer);
	}
}

export async function measure<T>(run: () => Promise<T>): Promise<{ value: T; latencyMs: number }> {
	const start = performance.now();
	const value = await run();

	return { value, latencyMs: Math.round(performance.now() - start) };
}

export function classifyLatency(latencyMs: number, slowMs: number): HealthStatus {
	return latencyMs > slowMs ? "DEGRADED" : "UP";
}
