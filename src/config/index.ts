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
	};

	return activeConfig;
}

export const config = loadConfig();
