-- AlterTable
ALTER TABLE "users" ADD COLUMN     "pin_hash" TEXT,
ADD COLUMN     "pin_tabs" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "plan_settings" (
    "plan" "Plan" NOT NULL,
    "price_cents" INTEGER NOT NULL,
    "instances" INTEGER NOT NULL,
    "audit_instances" INTEGER NOT NULL,
    "contracts" INTEGER NOT NULL,
    "portfolios" INTEGER NOT NULL,
    "audit_send" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plan_settings_pkey" PRIMARY KEY ("plan")
);

-- CreateTable
CREATE TABLE "verification_codes" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "purpose" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "verification_codes_user_id_purpose_idx" ON "verification_codes"("user_id", "purpose");

-- CreateIndex
CREATE INDEX "audit_messages_ts_idx" ON "audit_messages"("ts");

-- AddForeignKey
ALTER TABLE "verification_codes" ADD CONSTRAINT "verification_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
