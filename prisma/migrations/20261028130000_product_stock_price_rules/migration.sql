ALTER TABLE "products"
  ADD COLUMN "stock_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "stock_quantity" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "product_images"
  ADD COLUMN "stock_quantity" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "product_price_options"
  ALTER COLUMN "price_cents" DROP NOT NULL,
  ADD COLUMN "scope" TEXT NOT NULL DEFAULT 'same_product',
  ADD COLUMN "min_cart_cents" INTEGER NOT NULL DEFAULT 0;
