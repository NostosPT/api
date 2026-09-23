import { z } from "zod";

const bool = z
  .enum(["true", "false"])
  .default("false")
  .transform((v) => v === "true");

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().default(3000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  /** Comma-separated list of allowed browser origins (the website / admin). */
  CORS_ORIGINS: z.string().default("http://localhost:5173"),

  DATABASE_URL: z.url(),

  /** Used to sign gallery-access cookies. Min 32 chars. */
  COOKIE_SECRET: z.string().min(32),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),
  /** Set to true behind HTTPS (production). */
  COOKIE_SECURE: bool,

  S3_REGION: z.string().default("eu-west-1"),
  S3_BUCKET: z.string(),
  S3_ACCESS_KEY_ID: z.string(),
  S3_SECRET_ACCESS_KEY: z.string(),
  /** Custom endpoint for S3-compatible storage (MinIO locally). Leave empty for AWS. */
  S3_ENDPOINT: z.string().optional(),
  /** Endpoint used when signing URLs for browsers, if it differs from S3_ENDPOINT
   *  (e.g. API talks to http://minio:9000 inside Docker, browser uses http://localhost:9000). */
  S3_PUBLIC_ENDPOINT: z.string().optional(),
  S3_FORCE_PATH_STYLE: bool,
  S3_URL_TTL_SECONDS: z.coerce.number().int().positive().default(900),
});

export type Env = z.infer<typeof schema>;

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment variables:\n" + z.prettifyError(parsed.error));
  process.exit(1);
}

export const env: Env = parsed.data;
