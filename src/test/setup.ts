// Test setup - runs before all tests
// Sets up test environment variables before any config is loaded

process.env.NODE_ENV ??= "test";
process.env.DATABASE_URL ??= "postgresql://nostos:nostos@localhost:5432/nostos_test";
process.env.COOKIE_SECRET ??= "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.CORS_ORIGINS ??= "https://app.example.com";
process.env.SITE_COPYRIGHT ??= "© Nostos Studio";
process.env.SESSION_ABSOLUTE_SECONDS ??= String(30 * 24 * 60 * 60);
process.env.SESSION_IDLE_SECONDS ??= String(7 * 24 * 60 * 60);
process.env.SESSION_MAX_CONCURRENT ??= "10";
process.env.UPLOAD_MAX_BYTES ??= String(50 * 1024 * 1024);
process.env.S3_ENDPOINT ??= "";
process.env.S3_REGION ??= "";
process.env.S3_BUCKET ??= "";
process.env.S3_ACCESS_KEY_ID ??= "";
process.env.S3_SECRET_ACCESS_KEY ??= "";
process.env.S3_PUBLIC_ENDPOINT ??= "";
process.env.LOG_LEVEL ??= "silent";
process.env.DOCS_ENABLED ??= "true";
process.env.TRUST_PROXY ??= "";
process.env.S3_PUBLIC_ENDPOINT ??= "";