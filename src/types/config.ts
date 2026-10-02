export type NodeEnvironment =
	| "development"
	| "production"
	| "test";

export type LogLevel =
	| "fatal"
	| "error"
	| "warn"
	| "info"
	| "debug"
	| "trace"
	| "silent";

export interface RateLimitConfig {
	windowMs: number;
	max: number;
}

export interface SessionConfig {
	absoluteSeconds: number;
	idleSeconds: number;
	maxConcurrent: number;
}

export type StorageProvider = "s3";

export interface StorageConfig {
	provider: StorageProvider;
	endpoint: string | undefined;
	region: string | undefined;
	bucket: string | undefined;
	accessKeyId: string | undefined;
	secretAccessKey: string | undefined;
	publicEndpoint: string | undefined;
	// Path-style bucket addressing (required by SeaweedFS and most
	// self-hosted S3 implementations; AWS also accepts it).
	forcePathStyle: boolean;
}

// Seconds between runs of each probe group.
export interface MonitoringIntervals {
	database: number;
	storage: number;
	storageWrite: number;
	public: number;
	tls: number;
	backup: number;
}

export interface MonitoringConfig {
	enabled: boolean;
	// Base URL of the API as browsers reach it (through the proxy). Undefined
	// disables the PUBLIC_API and PUBLIC_API_TLS probes.
	publicApiUrl: string | undefined;
	// S3_PUBLIC_ENDPOINT when MONITOR_PUBLIC_STORAGE is on, else undefined.
	publicStorageUrl: string | undefined;
	retentionDays: number;
	intervals: MonitoringIntervals;
	// Consecutive results needed before a state change is accepted.
	failureThreshold: number;
	recoveryThreshold: number;
	timeoutMs: number;
	publicTimeoutMs: number;
	databaseSlowMs: number;
	storageSlowMs: number;
	publicSlowMs: number;
	tlsDegradedDays: number;
	tlsDownDays: number;
	backupDegradedHours: number;
	backupDownHours: number;
}

export interface AlertConfig {
	// Alerting is enabled only when both are set.
	resendApiKey: string | undefined;
	from: string | undefined;
	// Used only when no ADMIN recipient list has been cached yet.
	fallbackRecipients: string[];
}

export interface EnvConfig {
	NODE_ENV: NodeEnvironment;
	HOST: string;
	PORT: number;
	CORS_ORIGINS: string[];
	DATABASE_URL: string;
	COOKIE_SECRET: string;
	TRUST_PROXY: string;
	LOG_LEVEL: LogLevel | undefined;
	DOCS_ENABLED: boolean;
	SESSION_ABSOLUTE_SECONDS: number;
	SESSION_IDLE_SECONDS: number;
	SESSION_MAX_CONCURRENT: number;
	UPLOAD_MAX_BYTES: number;
	S3_ENDPOINT: string | undefined;
	S3_REGION: string | undefined;
	S3_BUCKET: string | undefined;
	S3_ACCESS_KEY_ID: string | undefined;
	S3_SECRET_ACCESS_KEY: string | undefined;
	S3_PUBLIC_ENDPOINT: string | undefined;
	S3_FORCE_PATH_STYLE: boolean;
	STORAGE_PROVIDER: StorageProvider;
	SITE_COPYRIGHT: string | undefined;
	MONITOR_ENABLED: boolean;
	MONITOR_PUBLIC_URL: string | undefined;
	MONITOR_PUBLIC_STORAGE: boolean;
	HEALTH_RETENTION_DAYS: number;
	MONITOR_INTERVAL_DATABASE_SECONDS: number;
	MONITOR_INTERVAL_STORAGE_SECONDS: number;
	MONITOR_INTERVAL_STORAGE_WRITE_SECONDS: number;
	MONITOR_INTERVAL_PUBLIC_SECONDS: number;
	MONITOR_INTERVAL_TLS_SECONDS: number;
	MONITOR_INTERVAL_BACKUP_SECONDS: number;
	MONITOR_FAILURE_THRESHOLD: number;
	MONITOR_RECOVERY_THRESHOLD: number;
	MONITOR_TIMEOUT_MS: number;
	MONITOR_PUBLIC_TIMEOUT_MS: number;
	MONITOR_DATABASE_SLOW_MS: number;
	MONITOR_STORAGE_SLOW_MS: number;
	MONITOR_PUBLIC_SLOW_MS: number;
	MONITOR_TLS_DEGRADED_DAYS: number;
	MONITOR_TLS_DOWN_DAYS: number;
	MONITOR_BACKUP_DEGRADED_HOURS: number;
	MONITOR_BACKUP_DOWN_HOURS: number;
	RESEND_API_KEY: string | undefined;
	ALERT_EMAIL_FROM: string | undefined;
	ALERT_FALLBACK_RECIPIENTS: string[];
}

export interface AppConfig {
	env: EnvConfig;
	app: {
		name: string;
		version: string;
	};
	rateLimit: RateLimitConfig;
	session: SessionConfig;
	storage: StorageConfig;
	monitoring: MonitoringConfig;
	alerts: AlertConfig;
}
