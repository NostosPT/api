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
}
