// Test-only environment defaults. Real secrets are never committed — these
// dummy values exist so importing configuration/Prisma in tests fails closed
// only when a test forgets to set its own values.
process.env.NODE_ENV ??= "test";
process.env.DATABASE_URL ??= "postgresql://nostos:nostos@localhost:5432/nostos_test";
process.env.COOKIE_SECRET ??= "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.CORS_ORIGINS ??= "https://app.example.com";
process.env.SITE_COPYRIGHT ??= "© Nostos Studio";
