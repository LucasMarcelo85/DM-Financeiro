ALTER TABLE "product_preferences"
ADD COLUMN "price_rules" JSONB NOT NULL DEFAULT '[]';
