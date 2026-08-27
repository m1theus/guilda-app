-- CreateEnum
CREATE TYPE "AttachmentStatus" AS ENUM ('PENDING', 'READY');

-- Attachment uploads are scoped to a channel and backed by private object storage.
ALTER TABLE "Attachment"
  ADD COLUMN "channelId" UUID,
  ADD COLUMN "storageKey" TEXT,
  ADD COLUMN "status" "AttachmentStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Existing rows predate object storage and cannot be safely claimed as uploads.
DELETE FROM "Attachment" WHERE "channelId" IS NULL OR "storageKey" IS NULL;

ALTER TABLE "Attachment"
  ALTER COLUMN "channelId" SET NOT NULL,
  ALTER COLUMN "storageKey" SET NOT NULL,
  DROP COLUMN "url";

CREATE UNIQUE INDEX "Attachment_storageKey_key" ON "Attachment"("storageKey");
CREATE INDEX "Attachment_channelId_status_idx" ON "Attachment"("channelId", "status");

ALTER TABLE "Attachment"
  ADD CONSTRAINT "Attachment_channelId_fkey"
  FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
