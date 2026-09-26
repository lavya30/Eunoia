-- AlterTable
ALTER TABLE "Subscription" ALTER COLUMN "provider" SET DEFAULT 'razorpay';

-- Backfill dev rows created by the stub provider so no production row
-- claims a provider that no longer exists.
UPDATE "Subscription" SET "provider" = 'razorpay' WHERE "provider" = 'stub';
