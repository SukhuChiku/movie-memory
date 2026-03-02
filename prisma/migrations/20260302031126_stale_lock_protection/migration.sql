/*
  Warnings:

  - You are about to drop the column `isGeneratingFact` on the `User` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "User" DROP COLUMN "isGeneratingFact",
ADD COLUMN     "generatingFactSince" TIMESTAMP(3);
