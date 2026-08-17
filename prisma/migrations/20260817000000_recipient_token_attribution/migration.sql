-- Per-recipient attribution: record WHICH recipient clicked a tracked link,
-- not just which campaign was clicked.
ALTER TABLE "LinkClick" ADD COLUMN "recipientToken" TEXT;
CREATE INDEX "LinkClick_recipientToken_idx" ON "LinkClick"("recipientToken");

-- The opening DM's postback button is what opens Meta's 24-hour messaging
-- window. Campaigns without it get exactly one message per person, ever, so it
-- ships on by default.
ALTER TABLE "Automation" ALTER COLUMN "openingDmEnabled" SET DEFAULT true;
