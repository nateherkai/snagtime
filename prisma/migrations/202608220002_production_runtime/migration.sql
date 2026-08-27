CREATE TABLE "RateLimitBucket" (
  "keyHash" TEXT NOT NULL PRIMARY KEY,
  "count" INTEGER NOT NULL DEFAULT 0,
  "windowEnd" DATETIME NOT NULL,
  "updatedAt" DATETIME NOT NULL
);
CREATE INDEX "RateLimitBucket_windowEnd_idx" ON "RateLimitBucket"("windowEnd");

CREATE TABLE "WorkerHeartbeat" (
  "workerId" TEXT NOT NULL PRIMARY KEY,
  "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" DATETIME NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'STARTING',
  "buildId" TEXT NOT NULL
);
CREATE INDEX "WorkerHeartbeat_lastSeenAt_idx" ON "WorkerHeartbeat"("lastSeenAt");
