import { config } from "../config/index.js";
import { email } from "../email/index.js";
import * as logger from "../logging/logger.js";
import { storage } from "../storage/index.js";
import type { MonitoringConfig } from "../types/config.js";
import { AlertNotifier } from "./notifier.js";
import { createBackupProbe } from "./probes/backup.js";
import { createDatabaseProbe } from "./probes/database.js";
import { createHttpProbe } from "./probes/http.js";
import { createStorageProbe } from "./probes/storage.js";
import { createTlsProbe, type InspectCertificate } from "./probes/tls.js";
import { RecipientCache, RECIPIENT_REFRESH_MS } from "./recipients.js";
import { CheckRecorder } from "./recorder.js";
import { insertHealthChecks, listActiveAdminEmails, loadBackupState, pingDatabase, pruneHealthHistory } from "./repository.js";
import { createPruner, PRUNE_INTERVAL_MS } from "./retention.js";
import { Scheduler } from "./scheduler.js";
import { StateTracker, type Transition } from "./stateTracker.js";
import type { CheckResult, HealthComponent, Probe } from "./types.js";

export interface ScheduledProbe {
	component: HealthComponent;
	probe: Probe;
}

export interface ProbeGroup {
	name: string;
	intervalSeconds: number;
	probes: ScheduledProbe[];
}

export interface ProbeDependencies {
	pingDatabase: () => Promise<unknown>;
	storage: typeof storage;
	loadBackupState: typeof loadBackupState;
	fetchImpl?: typeof fetch;
	inspect?: InspectCertificate;
}

function joinUrl(base: string, path: string): string {
	return `${base.replace(/\/+$/, "")}${path}`;
}

// Probe groups share an interval. Public and TLS probes exist only for the
// URLs that are configured (MONITOR_PUBLIC_URL, MONITOR_PUBLIC_STORAGE).
export function buildProbeGroups(monitoring: MonitoringConfig, deps: ProbeDependencies): ProbeGroup[] {
	const { intervals, timeoutMs, publicTimeoutMs } = monitoring;
	const publicProbes: ScheduledProbe[] = [];
	const tlsProbes: ScheduledProbe[] = [];
	const publicTargets = [
		{ base: monitoring.publicApiUrl, path: "/v1/health", http: "PUBLIC_API", tls: "PUBLIC_API_TLS" },
		// SeaweedFS answers /healthz on its S3 port, through the proxy.
		{ base: monitoring.publicStorageUrl, path: "/healthz", http: "PUBLIC_STORAGE", tls: "PUBLIC_STORAGE_TLS" },
	] as const;

	for (const target of publicTargets) {
		if (target.base === undefined) {
			continue;
		}

		publicProbes.push({
			component: target.http,
			probe: createHttpProbe({
				component: target.http,
				url: joinUrl(target.base, target.path),
				timeoutMs: publicTimeoutMs,
				slowMs: monitoring.publicSlowMs,
				fetchImpl: deps.fetchImpl,
			}),
		});
		tlsProbes.push({
			component: target.tls,
			probe: createTlsProbe({
				component: target.tls,
				url: target.base,
				timeoutMs: publicTimeoutMs,
				degradedDays: monitoring.tlsDegradedDays,
				downDays: monitoring.tlsDownDays,
				inspect: deps.inspect,
			}),
		});
	}

	const groups: ProbeGroup[] = [
		{
			name: "database",
			intervalSeconds: intervals.database,
			probes: [{ component: "DATABASE", probe: createDatabaseProbe({ ping: deps.pingDatabase, timeoutMs, slowMs: monitoring.databaseSlowMs }) }],
		},
		{
			name: "storage",
			intervalSeconds: intervals.storage,
			probes: [{
				component: "STORAGE",
				probe: createStorageProbe({ component: "STORAGE", run: (ms) => deps.storage.ping(ms), timeoutMs, slowMs: monitoring.storageSlowMs }),
			}],
		},
		{
			name: "storage-write",
			intervalSeconds: intervals.storageWrite,
			probes: [{
				component: "STORAGE_WRITE",
				probe: createStorageProbe({ component: "STORAGE_WRITE", run: (ms) => deps.storage.writeRoundTrip(ms), timeoutMs, slowMs: monitoring.storageSlowMs }),
			}],
		},
		{ name: "public", intervalSeconds: intervals.public, probes: publicProbes },
		{ name: "tls", intervalSeconds: intervals.tls, probes: tlsProbes },
		{
			name: "backup",
			intervalSeconds: intervals.backup,
			probes: [{
				component: "BACKUP",
				probe: createBackupProbe({
					load: deps.loadBackupState,
					degradedHours: monitoring.backupDegradedHours,
					downHours: monitoring.backupDownHours,
				}),
			}],
		},
	];

	return groups.filter((group) => group.probes.length > 0);
}

export interface Pipeline {
	recorder: { record(result: CheckResult): Promise<void> };
	tracker: { observe(result: CheckResult): Transition | null };
	notifier: { notify(transition: Transition): Promise<void> };
}

// One probe run: record the result, then alert on a confirmed change.
export async function runProbe(probe: Probe, pipeline: Pipeline): Promise<void> {
	const result = await probe();

	if (result === null) {
		return;
	}

	await pipeline.recorder.record(result);

	const transition = pipeline.tracker.observe(result);

	if (transition !== null) {
		await pipeline.notifier.notify(transition);
	}
}

export interface MonitorHandle {
	stop(): Promise<void>;
}

// Starts scheduled health monitoring when MONITOR_ENABLED. Assumes a single
// API replica: several would each probe and alert (DECISIONS.md).
export function startMonitoring(): MonitorHandle | null {
	const monitoring = config.monitoring;

	if (!monitoring.enabled) {
		logger.info("Health monitoring disabled (MONITOR_ENABLED=false)");

		return null;
	}

	if (!email.isConfigured()) {
		logger.warn("Alert emails disabled: set RESEND_API_KEY and ALERT_EMAIL_FROM to enable them");
	}

	const recipients = new RecipientCache(listActiveAdminEmails, config.alerts.fallbackRecipients);
	const recorder = new CheckRecorder(insertHealthChecks);
	const pipeline: Pipeline = {
		recorder,
		tracker: new StateTracker({
			failureThreshold: monitoring.failureThreshold,
			recoveryThreshold: monitoring.recoveryThreshold,
		}),
		notifier: new AlertNotifier(email, recipients),
	};
	const groups = buildProbeGroups(monitoring, { pingDatabase, storage, loadBackupState });
	const scheduler = new Scheduler();

	// Keep the recipient cache warm so it is usable during a database outage.
	scheduler.every("alert-recipients", RECIPIENT_REFRESH_MS, () => recipients.refresh());

	scheduler.every("prune-history", PRUNE_INTERVAL_MS, createPruner({
		retentionDays: monitoring.retentionDays,
		prune: pruneHealthHistory,
	}));

	for (const group of groups) {
		scheduler.every(`probe:${group.name}`, group.intervalSeconds * 1000, async () => {
			await Promise.all(group.probes.map(({ probe }) => runProbe(probe, pipeline)));
		});
	}

	const components = groups.flatMap((group) => group.probes.map((probe) => probe.component));

	logger.info(`Health monitoring started: ${components.join(", ")}`);

	return {
		async stop(): Promise<void> {
			await scheduler.stop();
			await recorder.flush();
		},
	};
}
