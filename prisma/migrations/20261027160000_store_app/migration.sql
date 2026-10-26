ALTER TABLE "stores" ADD COLUMN "app_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "stores" ADD COLUMN "app_name" TEXT;
ALTER TABLE "stores" ADD COLUMN "app_color" TEXT;

CREATE TABLE "store_users" (
  "id" SERIAL NOT NULL,
  "store_id" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "login" TEXT NOT NULL,
  "password_hash" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "store_users_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "store_users_store_id_login_key" ON "store_users"("store_id", "login");
ALTER TABLE "store_users" ADD CONSTRAINT "store_users_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;