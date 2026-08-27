-- Which reel a DM came from.
--
-- The worker already receives mediaId (it uses it to decide which campaigns
-- match) but never stored it. Without it, a catch-all campaign's DMs cannot be
-- split back out per reel, so a dashboard has to report one lump figure against
-- every reel the campaign could have fired on — which reads as data but isn't.
--
-- Nullable on purpose: rows written before this migration genuinely do not know
-- their reel, and inventing one would be worse than admitting the gap.
ALTER TABLE "DmLog" ADD COLUMN "mediaId" TEXT;
CREATE INDEX "DmLog_mediaId_idx" ON "DmLog"("mediaId");
