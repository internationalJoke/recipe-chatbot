-- CreateTable
CREATE TABLE "StoreLogo" (
    "store" VARCHAR(20) NOT NULL,
    "mimeType" VARCHAR(60) NOT NULL,
    "data" BYTEA NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoreLogo_pkey" PRIMARY KEY ("store")
);
