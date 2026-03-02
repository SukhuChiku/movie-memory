-- AlterTable
ALTER TABLE "User" ADD COLUMN     "isGeneratingFact" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "MovieFact_userId_createdAt_idx" ON "MovieFact"("userId", "createdAt");
