-- CreateTable
CREATE TABLE "IngestionLog" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "source" TEXT NOT NULL,
    "ranAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordsMatched" INTEGER NOT NULL,
    "fileName" TEXT NOT NULL,

    CONSTRAINT "IngestionLog_pkey" PRIMARY KEY ("id")
);
