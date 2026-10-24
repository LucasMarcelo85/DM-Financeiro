CREATE TABLE "product_price_options" (
    "id" SERIAL NOT NULL,
    "product_id" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "price_cents" INTEGER NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "product_price_options_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "product_price_options_product_id_position_idx" ON "product_price_options"("product_id", "position");

ALTER TABLE "product_price_options"
ADD CONSTRAINT "product_price_options_product_id_fkey"
FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
