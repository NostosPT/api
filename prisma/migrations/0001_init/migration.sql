-- Nostos initial migration (Phase 1 domain).
-- PostgreSQL extensions required by the schema and planned search indexes.
CREATE EXTENSION IF NOT EXISTS "citext";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'PHOTOGRAPHER', 'EDITOR', 'ASSISTANT', 'ACCOUNTANT');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "ClientStatus" AS ENUM ('LEAD', 'ACTIVE', 'PAST');

-- CreateEnum
CREATE TYPE "LeadSource" AS ENUM ('WEBSITE', 'EMAIL', 'REFERRAL', 'INSTAGRAM', 'ARCHIVE');

-- CreateEnum
CREATE TYPE "ActivityKind" AS ENUM ('NOTE', 'EMAIL', 'REQUEST', 'INVOICE', 'GALLERY', 'ORDER', 'CALL');

-- CreateEnum
CREATE TYPE "ServiceRequestStage" AS ENUM ('NEW', 'QUALIFIED', 'QUOTED', 'BOOKED', 'COMPLETED', 'LOST');

-- CreateEnum
CREATE TYPE "PhotoStatus" AS ENUM ('DRAFT', 'APPROVED', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "Visibility" AS ENUM ('PUBLIC', 'UNLISTED', 'PRIVATE');

-- CreateEnum
CREATE TYPE "Availability" AS ENUM ('NOT_FOR_SALE', 'AVAILABLE', 'SOLD_OUT');

-- CreateEnum
CREATE TYPE "AlbumType" AS ENUM ('WATERMARK', 'PAID', 'FREE');

-- CreateEnum
CREATE TYPE "AlbumStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "GalleryStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "PurchaseScope" AS ENUM ('PHOTO', 'PACK', 'ALBUM');

-- CreateEnum
CREATE TYPE "PurchaseStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "TagStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "TagVisibility" AS ENUM ('PUBLIC', 'INTERNAL');

-- CreateEnum
CREATE TYPE "CategoryStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "AuditResult" AS ENUM ('SUCCESS', 'FAILURE', 'DENIED');

-- CreateEnum
CREATE TYPE "UploadStatus" AS ENUM ('PENDING', 'READY', 'FAILED');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" CITEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "passwordHash" TEXT NOT NULL,
    "bio" TEXT,
    "avatarKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "ipHash" TEXT,
    "uaHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invite" (
    "id" UUID NOT NULL,
    "email" CITEXT NOT NULL,
    "role" "Role" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "invitedById" UUID,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Client" (
    "id" UUID NOT NULL,
    "clientCode" TEXT NOT NULL,
    "email" CITEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "company" TEXT,
    "notes" TEXT,
    "status" "ClientStatus" NOT NULL DEFAULT 'LEAD',
    "taxId" TEXT,
    "address" TEXT,
    "source" "LeadSource",
    "lastContactAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientActivity" (
    "id" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "kind" "ActivityKind" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "href" TEXT,
    "authorId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Service" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "priceFromCents" INTEGER,
    "priceToCents" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Service_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceRequest" (
    "id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "clientId" UUID NOT NULL,
    "serviceId" UUID,
    "stage" "ServiceRequestStage" NOT NULL DEFAULT 'NEW',
    "preferredDate" TIMESTAMP(3),
    "location" TEXT,
    "locationUndecided" BOOLEAN NOT NULL DEFAULT false,
    "budgetMinCents" INTEGER,
    "budgetMaxCents" INTEGER,
    "estimateFromCents" INTEGER,
    "estimateToCents" INTEGER,
    "quoteCents" INTEGER,
    "quoteId" TEXT,
    "assigneeId" UUID,
    "source" "LeadSource",
    "lostReason" TEXT,
    "contact" JSONB NOT NULL,
    "answers" JSONB NOT NULL,
    "referenceKeys" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequestNote" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "authorId" UUID,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RequestNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "status" "CategoryStatus" NOT NULL DEFAULT 'ACTIVE',
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhotoCategory" (
    "photoId" UUID NOT NULL,
    "categoryId" UUID NOT NULL,

    CONSTRAINT "PhotoCategory_pkey" PRIMARY KEY ("photoId","categoryId")
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "status" "TagStatus" NOT NULL DEFAULT 'ACTIVE',
    "visibility" "TagVisibility" NOT NULL DEFAULT 'PUBLIC',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhotoTag" (
    "photoId" UUID NOT NULL,
    "tagId" UUID NOT NULL,

    CONSTRAINT "PhotoTag_pkey" PRIMARY KEY ("photoId","tagId")
);

-- CreateTable
CREATE TABLE "AlbumTag" (
    "albumId" UUID NOT NULL,
    "tagId" UUID NOT NULL,

    CONSTRAINT "AlbumTag_pkey" PRIMARY KEY ("albumId","tagId")
);

-- CreateTable
CREATE TABLE "Photo" (
    "id" UUID NOT NULL,
    "number" SERIAL NOT NULL,
    "title" TEXT,
    "description" TEXT,
    "originalKey" TEXT NOT NULL,
    "displayKey" TEXT,
    "thumbnailKey" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "takenAt" TIMESTAMP(3),
    "location" TEXT,
    "status" "PhotoStatus" NOT NULL DEFAULT 'DRAFT',
    "visibility" "Visibility" NOT NULL DEFAULT 'PRIVATE',
    "availability" "Availability" NOT NULL DEFAULT 'NOT_FOR_SALE',
    "priceCents" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "photographerId" UUID,
    "uploadStatus" "UploadStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Photo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Gallery" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "GalleryStatus" NOT NULL DEFAULT 'DRAFT',
    "position" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Gallery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GalleryPhoto" (
    "galleryId" UUID NOT NULL,
    "photoId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GalleryPhoto_pkey" PRIMARY KEY ("galleryId","photoId")
);

-- CreateTable
CREATE TABLE "Album" (
    "id" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "type" "AlbumType" NOT NULL,
    "status" "AlbumStatus" NOT NULL DEFAULT 'DRAFT',
    "accessCodeHash" TEXT,
    "secretVersion" INTEGER NOT NULL DEFAULT 1,
    "priceCents" INTEGER,
    "packPriceCents" INTEGER,
    "packSize" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "coverPhotoId" UUID,
    "expiresAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "views" INTEGER NOT NULL DEFAULT 0,
    "lastViewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Album_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlbumPhoto" (
    "albumId" UUID NOT NULL,
    "photoId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "isPreview" BOOLEAN NOT NULL DEFAULT true,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AlbumPhoto_pkey" PRIMARY KEY ("albumId","photoId")
);

-- CreateTable
CREATE TABLE "Favorite" (
    "id" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "albumId" UUID NOT NULL,
    "photoId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Favorite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Purchase" (
    "id" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "scope" "PurchaseScope" NOT NULL,
    "albumId" UUID NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "status" "PurchaseStatus" NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Purchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchasePhoto" (
    "purchaseId" UUID NOT NULL,
    "photoId" UUID NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchasePhoto_pkey" PRIMARY KEY ("purchaseId","photoId")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "actorId" UUID,
    "action" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "result" "AuditResult" NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_status_idx" ON "User"("role", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_expiresAt_idx" ON "Session"("userId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Invite_tokenHash_key" ON "Invite"("tokenHash");

-- CreateIndex
CREATE INDEX "Invite_email_idx" ON "Invite"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Client_clientCode_key" ON "Client"("clientCode");

-- CreateIndex
CREATE UNIQUE INDEX "Client_email_key" ON "Client"("email");

-- CreateIndex
CREATE INDEX "Client_status_updatedAt_idx" ON "Client"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "ClientActivity_clientId_createdAt_idx" ON "ClientActivity"("clientId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "Service_slug_key" ON "Service"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Service_name_key" ON "Service"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Service_position_key" ON "Service"("position");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceRequest_reference_key" ON "ServiceRequest"("reference");

-- CreateIndex
CREATE INDEX "ServiceRequest_stage_updatedAt_idx" ON "ServiceRequest"("stage", "updatedAt" DESC);

-- CreateIndex
CREATE INDEX "ServiceRequest_serviceId_idx" ON "ServiceRequest"("serviceId");

-- CreateIndex
CREATE INDEX "ServiceRequest_clientId_idx" ON "ServiceRequest"("clientId");

-- CreateIndex
CREATE INDEX "ServiceRequest_assigneeId_idx" ON "ServiceRequest"("assigneeId");

-- CreateIndex
CREATE INDEX "RequestNote_requestId_createdAt_idx" ON "RequestNote"("requestId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Category_name_key" ON "Category"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Category_slug_key" ON "Category"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Category_position_key" ON "Category"("position");

-- CreateIndex
CREATE INDEX "PhotoCategory_categoryId_idx" ON "PhotoCategory"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_name_key" ON "Tag"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_slug_key" ON "Tag"("slug");

-- CreateIndex
CREATE INDEX "PhotoTag_tagId_idx" ON "PhotoTag"("tagId");

-- CreateIndex
CREATE INDEX "AlbumTag_tagId_idx" ON "AlbumTag"("tagId");

-- CreateIndex
CREATE UNIQUE INDEX "Photo_number_key" ON "Photo"("number");

-- CreateIndex
CREATE UNIQUE INDEX "Photo_originalKey_key" ON "Photo"("originalKey");

-- CreateIndex
CREATE INDEX "Photo_status_visibility_createdAt_idx" ON "Photo"("status", "visibility", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Photo_photographerId_idx" ON "Photo"("photographerId");

-- CreateIndex
CREATE INDEX "Photo_availability_idx" ON "Photo"("availability");

-- CreateIndex
CREATE UNIQUE INDEX "Gallery_slug_key" ON "Gallery"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Gallery_position_key" ON "Gallery"("position");

-- CreateIndex
CREATE INDEX "GalleryPhoto_photoId_idx" ON "GalleryPhoto"("photoId");

-- CreateIndex
CREATE UNIQUE INDEX "GalleryPhoto_galleryId_position_key" ON "GalleryPhoto"("galleryId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "Album_slug_key" ON "Album"("slug");

-- CreateIndex
CREATE INDEX "Album_clientId_status_idx" ON "Album"("clientId", "status");

-- CreateIndex
CREATE INDEX "AlbumPhoto_photoId_idx" ON "AlbumPhoto"("photoId");

-- CreateIndex
CREATE UNIQUE INDEX "AlbumPhoto_albumId_position_key" ON "AlbumPhoto"("albumId", "position");

-- CreateIndex
CREATE INDEX "Favorite_clientId_idx" ON "Favorite"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "Favorite_clientId_albumId_photoId_key" ON "Favorite"("clientId", "albumId", "photoId");

-- CreateIndex
CREATE INDEX "Purchase_clientId_status_createdAt_idx" ON "Purchase"("clientId", "status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Purchase_albumId_idx" ON "Purchase"("albumId");

-- CreateIndex
CREATE INDEX "PurchasePhoto_photoId_idx" ON "PurchasePhoto"("photoId");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "AuditLog_resourceType_resourceId_idx" ON "AuditLog"("resourceType", "resourceId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt" DESC);

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invite" ADD CONSTRAINT "Invite_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientActivity" ADD CONSTRAINT "ClientActivity_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientActivity" ADD CONSTRAINT "ClientActivity_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceRequest" ADD CONSTRAINT "ServiceRequest_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceRequest" ADD CONSTRAINT "ServiceRequest_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceRequest" ADD CONSTRAINT "ServiceRequest_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestNote" ADD CONSTRAINT "RequestNote_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ServiceRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestNote" ADD CONSTRAINT "RequestNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhotoCategory" ADD CONSTRAINT "PhotoCategory_photoId_fkey" FOREIGN KEY ("photoId") REFERENCES "Photo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhotoCategory" ADD CONSTRAINT "PhotoCategory_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhotoTag" ADD CONSTRAINT "PhotoTag_photoId_fkey" FOREIGN KEY ("photoId") REFERENCES "Photo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhotoTag" ADD CONSTRAINT "PhotoTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlbumTag" ADD CONSTRAINT "AlbumTag_albumId_fkey" FOREIGN KEY ("albumId") REFERENCES "Album"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlbumTag" ADD CONSTRAINT "AlbumTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Photo" ADD CONSTRAINT "Photo_photographerId_fkey" FOREIGN KEY ("photographerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GalleryPhoto" ADD CONSTRAINT "GalleryPhoto_galleryId_fkey" FOREIGN KEY ("galleryId") REFERENCES "Gallery"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GalleryPhoto" ADD CONSTRAINT "GalleryPhoto_photoId_fkey" FOREIGN KEY ("photoId") REFERENCES "Photo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Album" ADD CONSTRAINT "Album_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Album" ADD CONSTRAINT "Album_coverPhotoId_fkey" FOREIGN KEY ("coverPhotoId") REFERENCES "Photo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlbumPhoto" ADD CONSTRAINT "AlbumPhoto_albumId_fkey" FOREIGN KEY ("albumId") REFERENCES "Album"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlbumPhoto" ADD CONSTRAINT "AlbumPhoto_photoId_fkey" FOREIGN KEY ("photoId") REFERENCES "Photo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Favorite" ADD CONSTRAINT "Favorite_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Favorite" ADD CONSTRAINT "Favorite_albumId_photoId_fkey" FOREIGN KEY ("albumId", "photoId") REFERENCES "AlbumPhoto"("albumId", "photoId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_albumId_fkey" FOREIGN KEY ("albumId") REFERENCES "Album"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchasePhoto" ADD CONSTRAINT "PurchasePhoto_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchasePhoto" ADD CONSTRAINT "PurchasePhoto_photoId_fkey" FOREIGN KEY ("photoId") REFERENCES "Photo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Nostos custom indexes (not expressible in Prisma schema).
CREATE INDEX "Client_name_trgm_idx" ON "Client" USING GIN ("name" gin_trgm_ops);
CREATE INDEX "Photo_title_trgm_idx" ON "Photo" USING GIN ("title" gin_trgm_ops);
CREATE INDEX "Photo_public_listing_idx" ON "Photo" ("createdAt" DESC) WHERE "status" = 'PUBLISHED' AND "visibility" = 'PUBLIC';
