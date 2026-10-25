ALTER TABLE "product_price_options"
ALTER COLUMN "price_cents" DROP NOT NULL;

UPDATE "product_images"
SET "price_cents" = NULL
WHERE "price_cents" IS NOT NULL;
