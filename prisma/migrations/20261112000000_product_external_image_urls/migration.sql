ALTER TABLE "product_images"
  ALTER COLUMN "mime" DROP NOT NULL,
  ALTER COLUMN "data" DROP NOT NULL,
  ADD COLUMN "external_url" TEXT;
