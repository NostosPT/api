-- Restore the trigram search indexes from 0001_init that
-- 20260929122206_atlas_locations dropped as drift, and index Photo.description
-- too: the public photo search matches title OR description, which can only
-- use a BitmapOr plan when both columns are indexed. The indexes are now
-- declared in schema.prisma, so migrate diff keeps them.
--
-- Reversal:
--   DROP INDEX "Client_name_trgm_idx";
--   DROP INDEX "Photo_title_trgm_idx";
--   DROP INDEX "Photo_description_trgm_idx";

-- CreateIndex
CREATE INDEX "Client_name_trgm_idx" ON "Client" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Photo_title_trgm_idx" ON "Photo" USING GIN ("title" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Photo_description_trgm_idx" ON "Photo" USING GIN ("description" gin_trgm_ops);
