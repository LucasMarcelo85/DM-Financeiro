ALTER TABLE "stock_levels"
ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true;

INSERT INTO "stock_levels" ("flow_id", "product_id", "variant_key", "quantity", "is_active")
SELECT f."id", p."id", 'product',
  CASE WHEN f."is_default" THEN p."stock_quantity" ELSE 0 END,
  true
FROM "stock_flows" f
JOIN "products" p ON p."user_id" = f."user_id"
  AND p."store_id" IS NOT DISTINCT FROM f."store_id"
WHERE NOT EXISTS (
  SELECT 1 FROM "stock_levels" sl
  WHERE sl."flow_id" = f."id" AND sl."product_id" = p."id" AND sl."variant_key" = 'product'
);
