-- CreateEnum
CREATE TYPE "HealthComponent" AS ENUM ('DATABASE', 'STORAGE', 'STORAGE_WRITE', 'PUBLIC_API', 'PUBLIC_API_TLS', 'PUBLIC_STORAGE', 'PUBLIC_STORAGE_TLS', 'BACKUP');

-- CreateEnum
CREATE TYPE "HealthStatus" AS ENUM ('UP', 'DEGRADED', 'DOWN');

-- CreateEnum
CREATE TYPE "BackupRunStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "HealthCheck" (
    "id" UUID NOT NULL,
    "component" "HealthComponent" NOT NULL,
    "status" "HealthStatus" NOT NULL,
    "latencyMs" INTEGER,
    "errorCode" TEXT,
    "checkedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HealthCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BackupRun" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "status" "BackupRunStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "errorCode" TEXT,

    CONSTRAINT "BackupRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HealthCheck_component_checkedAt_idx" ON "HealthCheck"("component", "checkedAt" DESC);

-- CreateIndex
CREATE INDEX "HealthCheck_checkedAt_idx" ON "HealthCheck"("checkedAt");

-- CreateIndex
CREATE INDEX "BackupRun_status_startedAt_idx" ON "BackupRun"("status", "startedAt" DESC);

-- CreateIndex
CREATE INDEX "BackupRun_startedAt_idx" ON "BackupRun"("startedAt");

