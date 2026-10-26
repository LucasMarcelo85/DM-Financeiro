CREATE TABLE "stores" (
  "id" SERIAL NOT NULL,
  "user_id" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "custom_domain" TEXT,
  "custom_domain_verified_at" TIMESTAMP(3),
  "config" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "stores_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "stores_slug_key" ON "stores"("slug");
CREATE UNIQUE INDEX "stores_custom_domain_key" ON "stores"("custom_domain");
CREATE INDEX "stores_user_id_idx" ON "stores"("user_id");
ALTER TABLE "stores" ADD CONSTRAINT "stores_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "products" ADD COLUMN "store_id" INTEGER;
ALTER TABLE "portfolios" ADD COLUMN "store_id" INTEGER;
ALTER TABLE "orders" ADD COLUMN "store_id" INTEGER;
CREATE INDEX "products_store_id_idx" ON "products"("store_id");
CREATE INDEX "orders_store_id_idx" ON "orders"("store_id");
