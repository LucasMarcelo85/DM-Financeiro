-- Planos deixam de ser um tipo fixo (enum) e viram linhas editáveis pelo administrador.
ALTER TABLE "users" ALTER COLUMN "plan" DROP DEFAULT;
ALTER TABLE "users" ALTER COLUMN "plan" TYPE TEXT USING "plan"::text;
ALTER TABLE "users" ALTER COLUMN "plan" SET DEFAULT 'bronze';
ALTER TABLE "payments" ALTER COLUMN "plan" TYPE TEXT USING "plan"::text;
ALTER TABLE "plan_settings" ALTER COLUMN "plan" TYPE TEXT USING "plan"::text;
DROP TYPE "Plan";

-- AlterTable
ALTER TABLE "plan_settings" ADD COLUMN     "catalog_products" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "color" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "name" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "sort_order" INTEGER NOT NULL DEFAULT 0;

-- Planos que já existem: nome, ordem e catálogo (bronze sem catálogo, prata 40 produtos, ouro 120).
UPDATE "plan_settings" SET "name" = 'Bronze', "sort_order" = 1, "catalog_products" = 0 WHERE "plan" = 'bronze';
UPDATE "plan_settings" SET "name" = 'Prata', "sort_order" = 2, "catalog_products" = 40 WHERE "plan" = 'prata';
UPDATE "plan_settings" SET "name" = 'Ouro', "sort_order" = 3, "catalog_products" = 120 WHERE "plan" = 'ouro';

-- AlterTable
ALTER TABLE "portfolios" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'site';

-- CreateTable
CREATE TABLE "products" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'produto',
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "price_cents" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_images" (
    "id" SERIAL NOT NULL,
    "product_id" INTEGER NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "label" TEXT NOT NULL DEFAULT '',
    "price_cents" INTEGER,
    "mime" TEXT NOT NULL,
    "data" BYTEA NOT NULL,

    CONSTRAINT "product_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_settings" (
    "user_id" INTEGER NOT NULL,
    "config" JSONB NOT NULL,
    "superfrete" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "catalog_settings_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "customer_name" TEXT NOT NULL,
    "customer_phone" TEXT NOT NULL,
    "delivery_type" TEXT NOT NULL,
    "delivery" JSONB NOT NULL,
    "items" JSONB NOT NULL,
    "subtotal_cents" INTEGER NOT NULL,
    "shipping_cents" INTEGER NOT NULL,
    "total_cents" INTEGER NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'novo',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "products_user_id_category_idx" ON "products"("user_id", "category");

-- CreateIndex
CREATE INDEX "product_images_product_id_position_idx" ON "product_images"("product_id", "position");

-- CreateIndex
CREATE INDEX "orders_user_id_created_at_idx" ON "orders"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "orders_created_at_idx" ON "orders"("created_at");

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_settings" ADD CONSTRAINT "catalog_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
