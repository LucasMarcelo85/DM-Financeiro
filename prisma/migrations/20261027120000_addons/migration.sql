CREATE TABLE "addon_settings" (
  "resource" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "pack_units" INTEGER NOT NULL DEFAULT 1,
  "price_cents" INTEGER NOT NULL DEFAULT 0,
  "max_packs" INTEGER NOT NULL DEFAULT 20,
  CONSTRAINT "addon_settings_pkey" PRIMARY KEY ("resource")
);

CREATE TABLE "user_addons" (
  "id" SERIAL NOT NULL,
  "user_id" INTEGER NOT NULL,
  "resource" TEXT NOT NULL,
  "units" INTEGER NOT NULL,
  "paid_until" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_addons_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "user_addons_user_id_idx" ON "user_addons"("user_id");
ALTER TABLE "user_addons" ADD CONSTRAINT "user_addons_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "payments" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'plan';
ALTER TABLE "payments" ADD COLUMN "items" JSONB;
