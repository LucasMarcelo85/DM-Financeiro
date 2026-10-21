-- AlterTable
ALTER TABLE "users" ADD COLUMN "custom_domain" TEXT,
ADD COLUMN "custom_domain_verified_at" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "users_custom_domain_key" ON "users"("custom_domain");
