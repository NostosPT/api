-- CreateEnum
CREATE TYPE "AtlasLocationStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AtlasGeometryKind" AS ENUM ('POINT', 'AREA');

-- DropIndex
DROP INDEX "Client_name_trgm_idx";

-- DropIndex
DROP INDEX "Photo_title_trgm_idx";

-- CreateTable
CREATE TABLE "AtlasLocation" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "country" TEXT,
    "region" TEXT,
    "city" TEXT,
    "geometryKind" "AtlasGeometryKind" NOT NULL DEFAULT 'POINT',
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "geoJson" JSONB,
    "whyInteresting" TEXT,
    "subjects" TEXT,
    "accessNotes" TEXT,
    "safetyNotes" TEXT,
    "status" "AtlasLocationStatus" NOT NULL DEFAULT 'DRAFT',
    "coverPhotoId" UUID,
    "authorId" UUID,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AtlasLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AtlasLocationCategory" (
    "locationId" UUID NOT NULL,
    "categoryId" UUID NOT NULL,

    CONSTRAINT "AtlasLocationCategory_pkey" PRIMARY KEY ("locationId","categoryId")
);

-- CreateTable
CREATE TABLE "AtlasLocationPhoto" (
    "locationId" UUID NOT NULL,
    "photoId" UUID NOT NULL,
    "caption" TEXT,
    "position" INTEGER NOT NULL,

    CONSTRAINT "AtlasLocationPhoto_pkey" PRIMARY KEY ("locationId","photoId")
);

-- CreateIndex
CREATE UNIQUE INDEX "AtlasLocation_slug_key" ON "AtlasLocation"("slug");

-- CreateIndex
CREATE INDEX "AtlasLocation_status_idx" ON "AtlasLocation"("status");

-- CreateIndex
CREATE INDEX "AtlasLocation_country_idx" ON "AtlasLocation"("country");

-- CreateIndex
CREATE INDEX "AtlasLocation_status_country_idx" ON "AtlasLocation"("status", "country");

-- CreateIndex
CREATE INDEX "AtlasLocationCategory_categoryId_idx" ON "AtlasLocationCategory"("categoryId");

-- CreateIndex
CREATE INDEX "AtlasLocationPhoto_photoId_idx" ON "AtlasLocationPhoto"("photoId");

-- CreateIndex
CREATE UNIQUE INDEX "AtlasLocationPhoto_locationId_position_key" ON "AtlasLocationPhoto"("locationId", "position");

-- AddForeignKey
ALTER TABLE "AtlasLocation" ADD CONSTRAINT "AtlasLocation_coverPhotoId_fkey" FOREIGN KEY ("coverPhotoId") REFERENCES "Photo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AtlasLocation" ADD CONSTRAINT "AtlasLocation_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AtlasLocationCategory" ADD CONSTRAINT "AtlasLocationCategory_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "AtlasLocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AtlasLocationCategory" ADD CONSTRAINT "AtlasLocationCategory_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AtlasLocationPhoto" ADD CONSTRAINT "AtlasLocationPhoto_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "AtlasLocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AtlasLocationPhoto" ADD CONSTRAINT "AtlasLocationPhoto_photoId_fkey" FOREIGN KEY ("photoId") REFERENCES "Photo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
