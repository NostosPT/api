import type { HealthComponent, HealthStatus } from "@prisma/client";
import { config } from "../../config/index.js";
import { COMPONENT_LABELS } from "../../monitoring/notifier.js";
import {
	countChecksSince,
	loadBackupState,
	loadLatestBackupRun,
	loadLatestChecks,
	type StatusCount,
} from "../../monitoring/repository.js";
import type { MonitoringConfig } from "../../types/config.js";
import { uptimePercent, type SystemStatusDTO } from "./dto.js";

const HOUR_MS = 60 * 60 * 1000;
const WINDOWS = { last24h: 24 * HOUR_MS, last7d: 7 * 24 * HOUR_MS, last30d: 30 * 24 * HOUR_MS } as const;

// Display order; matches the HealthComponent enum.
const ALL_COMPONENTS: HealthComponent[] = [
	"DATABASE",
	"STORAGE",
	"STORAGE_WRITE",
	"PUBLIC_API",
	"PUBLIC_API_TLS",
	"PUBLIC_STORAGE",
	"PUBLIC_STORAGE_TLS",
	"BACKUP",
];

export function configuredComponents(monitoring: MonitoringConfig): Set<HealthComponent> {
	const components = new Set<HealthComponent>(["DATABASE", "STORAGE", "STORAGE_WRITE", "BACKUP"]);

	if (monitoring.publicApiUrl !== undefined) {
		components.add("PUBLIC_API");
		components.add("PUBLIC_API_TLS");
	}

	if (monitoring.publicStorageUrl !== undefined) {
		components.add("PUBLIC_STORAGE");
		components.add("PUBLIC_STORAGE_TLS");
	}

	return components;
}

function tally(counts: StatusCount[]): Map<HealthComponent, Partial<Record<HealthStatus, number>>> {
	const byComponent = new Map<HealthComponent, Partial<Record<HealthStatus, number>>>();

	for (const { component, status, count } of counts) {
		const entry = byComponent.get(component) ?? {};

		entry[status] = (entry[status] ?? 0) + count;
		byComponent.set(component, entry);
	}

	return byComponent;
}

// Components shown: everything currently configured, plus anything with
// history in the last 30 days (e.g. a probe that was since disabled).
export async function getSystemStatus(now: Date = new Date()): Promise<SystemStatusDTO> {
	const [counts24h, counts7d, counts30d, backupState, latestRun] = await Promise.all([
		countChecksSince(new Date(now.getTime() - WINDOWS.last24h)),
		countChecksSince(new Date(now.getTime() - WINDOWS.last7d)),
		countChecksSince(new Date(now.getTime() - WINDOWS.last30d)),
		loadBackupState(),
		loadLatestBackupRun(),
	]);

	const shown = configuredComponents(config.monitoring);

	for (const { component } of counts30d) {
		shown.add(component);
	}

	const components = ALL_COMPONENTS.filter((component) => shown.has(component));
	const latest = new Map((await loadLatestChecks(components)).map((check) => [check.component, check]));
	const [by24h, by7d, by30d] = [tally(counts24h), tally(counts7d), tally(counts30d)];

	return {
		generatedAt: now.toISOString(),
		monitoringEnabled: config.monitoring.enabled,
		components: components.map((component) => {
			const check = latest.get(component);

			return {
				component,
				label: COMPONENT_LABELS[component],
				status: check?.status ?? null,
				lastCheckedAt: check?.checkedAt.toISOString() ?? null,
				latencyMs: check?.latencyMs ?? null,
				errorCode: check?.errorCode ?? null,
				uptime: {
					last24h: uptimePercent(by24h.get(component) ?? {}),
					last7d: uptimePercent(by7d.get(component) ?? {}),
					last30d: uptimePercent(by30d.get(component) ?? {}),
				},
			};
		}),
		backup: {
			lastSucceededAt: backupState.latestSucceeded?.finishedAt.toISOString() ?? null,
			lastRunStatus: latestRun?.status ?? null,
			lastRunStartedAt: latestRun?.startedAt.toISOString() ?? null,
		},
	};
}
