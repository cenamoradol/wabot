-- AlterTable
ALTER TABLE "PhoneNumber" ADD COLUMN     "userAccessToken" TEXT,
ADD COLUMN     "userAccessTokenExpiresAt" TIMESTAMP(3),
ADD COLUMN     "wabaId" TEXT;
