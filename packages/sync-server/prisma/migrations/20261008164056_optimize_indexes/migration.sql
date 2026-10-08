-- DropIndex
DROP INDEX "ImageAsset_roomId_idx";

-- CreateIndex
CREATE INDEX "Room_updatedAt_idx" ON "Room"("updatedAt");

-- CreateIndex
CREATE INDEX "Room_workspaceId_updatedAt_idx" ON "Room"("workspaceId", "updatedAt");

-- CreateIndex
CREATE INDEX "Room_ownerId_updatedAt_idx" ON "Room"("ownerId", "updatedAt");

-- CreateIndex
CREATE INDEX "Subscription_providerSubId_idx" ON "Subscription"("providerSubId");
