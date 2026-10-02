import { errorCodeOf } from "../errors.js";
import { classifyLatency, measure } from "../timing.js";
import type { Clock, Probe } from "../types.js";

export interface HttpProbeOptions {
	component: "PUBLIC_API" | "PUBLIC_STORAGE";
	// Full URL to GET, reached through the public proxy like a browser would.
	url: string;
	timeoutMs: number;
	slowMs: number;
	fetchImpl?: typeof fetch;
	clock?: Clock;
}

// Only a direct 200 counts: redirects are not followed, because a redirect
// on a health path means the proxy is misrouting.
export function createHttpProbe(options: HttpProbeOptions): Probe {
	const clock = options.clock ?? (() => new Date());
	const fetchImpl = options.fetchImpl ?? fetch;

	return async () => {
		const checkedAt = clock();

		try {
			const { value: response, latencyMs } = await measure(async () => {
				const result = await fetchImpl(options.url, {
					method: "GET",
					redirect: "manual",
					cache: "no-store",
					headers: { "User-Agent": "nostos-health-monitor" },
					signal: AbortSignal.timeout(options.timeoutMs),
				});

				// Drain the body so the connection is released.
				await result.arrayBuffer();

				return result;
			});

			if (response.status !== 200) {
				return { component: options.component, status: "DOWN", latencyMs, errorCode: `http_${response.status}`, checkedAt };
			}

			return {
				component: options.component,
				status: classifyLatency(latencyMs, options.slowMs),
				latencyMs,
				errorCode: null,
				checkedAt,
			};
		}
		catch (error) {
			return { component: options.component, status: "DOWN", latencyMs: null, errorCode: errorCodeOf(error), checkedAt };
		}
	};
}
