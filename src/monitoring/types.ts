import type { HealthComponent, HealthStatus } from "@prisma/client";

export type { HealthComponent, HealthStatus };

// One probe outcome. `errorCode` is short and sanitized (timeout,
// database_not_reachable, http_503): never raw messages, hosts, or keys.
export interface CheckResult {
	component: HealthComponent;
	status: HealthStatus;
	latencyMs: number | null;
	errorCode: string | null;
	checkedAt: Date;
}

// Resolves to null when the component does not apply (e.g. storage not
// configured): nothing is recorded or alerted for that run.
export type Probe = () => Promise<CheckResult | null>;

export type Clock = () => Date;
