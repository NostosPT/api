-- Per-year counters for generated codes (CLI-YYYY-NNN, REQ-YYYY-NNN).
-- Replaces read-max-then-insert generation, which ordered codes as text
-- (REQ-2026-1000 sorts before REQ-2026-999) and raced under concurrent inserts.
--
-- Additive only: no existing table, column, index or row is modified.
-- Rollback: DROP TABLE "CodeCounter"; (code before this migration never reads it).

-- CreateTable
CREATE TABLE "CodeCounter" (
    "scope" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "value" INTEGER NOT NULL,

    CONSTRAINT "CodeCounter_pkey" PRIMARY KEY ("scope","year")
);

-- Seed each counter with the highest number already issued that year,
-- compared numerically, so existing codes stay valid and are never reissued.
-- Codes outside the CLI-YYYY-N / REQ-YYYY-N shape are ignored.
INSERT INTO "CodeCounter" ("scope", "year", "value")
SELECT 'CLIENT', (m)[1]::INTEGER, MAX((m)[2]::INTEGER)
FROM (SELECT regexp_match("clientCode", '^CLI-(\d{4})-(\d{1,9})$') AS m FROM "Client") AS codes
WHERE m IS NOT NULL
GROUP BY (m)[1];

INSERT INTO "CodeCounter" ("scope", "year", "value")
SELECT 'SERVICE_REQUEST', (m)[1]::INTEGER, MAX((m)[2]::INTEGER)
FROM (SELECT regexp_match("reference", '^REQ-(\d{4})-(\d{1,9})$') AS m FROM "ServiceRequest") AS codes
WHERE m IS NOT NULL
GROUP BY (m)[1];
