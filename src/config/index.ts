import type { AppConfig } from "../types/config.js";
import { validateEnv } from "./env.js";

let activeConfig: AppConfig | null = null;

export function loadConfig(): AppConfig {
	if (activeConfig) {
		return activeConfig;
	}

	const env = validateEnv();

	activeConfig = {
		env,
		app: {
			name: "api",
			version: "1.0.0",
		},
		rateLimit: {
			windowMs: 15 * 60 * 1000, // 15 minutes
			max: 100, // limit each IP to 100 requests per windowMs
		},
		session: {
			absoluteSeconds: env.SESSION_ABSOLUTE_SECONDS,
			idleSeconds: env.SESSION_IDLE_SECONDS,
			maxConcurrent: env.SESSION_MAX_CONCURRENT,
		},
		storage: {
			provider: env.STORAGE_PROVIDER,
			endpoint: env.S3_ENDPOINT,
			region: env.S3_REGION,
			bucket: env.S3_BUCKET,
			accessKeyId: env.S3_ACCESS_KEY_ID,
			secretAccessKey: env.S3_SECRET_ACCESS_KEY,
			publicEndpoint: env.S3_PUBLIC_ENDPOINT,
			forcePathStyle: env.S3_FORCE_PATH_STYLE,
		},
		monitoring: {
			enabled: env.MONITOR_ENABLED,
			publicApiUrl: env.MONITOR_PUBLIC_URL,
			publicStorageUrl: env.MONITOR_PUBLIC_STORAGE ? env.S3_PUBLIC_ENDPOINT : undefined,
			retentionDays: env.HEALTH_RETENTION_DAYS,
			intervals: {
				database: env.MONITOR_INTERVAL_DATABASE_SECONDS,
				storage: env.MONITOR_INTERVAL_STORAGE_SECONDS,
				storageWrite: env.MONITOR_INTERVAL_STORAGE_WRITE_SECONDS,
				public: env.MONITOR_INTERVAL_PUBLIC_SECONDS,
				tls: env.MONITOR_INTERVAL_TLS_SECONDS,
				backup: env.MONITOR_INTERVAL_BACKUP_SECONDS,
			},
			failureThreshold: env.MONITOR_FAILURE_THRESHOLD,
			recoveryThreshold: env.MONITOR_RECOVERY_THRESHOLD,
			timeoutMs: env.MONITOR_TIMEOUT_MS,
			publicTimeoutMs: env.MONITOR_PUBLIC_TIMEOUT_MS,
			databaseSlowMs: env.MONITOR_DATABASE_SLOW_MS,
			storageSlowMs: env.MONITOR_STORAGE_SLOW_MS,
			publicSlowMs: env.MONITOR_PUBLIC_SLOW_MS,
			tlsDegradedDays: env.MONITOR_TLS_DEGRADED_DAYS,
			tlsDownDays: env.MONITOR_TLS_DOWN_DAYS,
			backupDegradedHours: env.MONITOR_BACKUP_DEGRADED_HOURS,
			backupDownHours: env.MONITOR_BACKUP_DOWN_HOURS,
		},
		alerts: {
			resendApiKey: env.RESEND_API_KEY,
			from: env.ALERT_EMAIL_FROM,
			fallbackRecipients: env.ALERT_FALLBACK_RECIPIENTS,
		},
	};

	return activeConfig;
}

export const config = loadConfig();
