ALTER TABLE "stores"
  ADD COLUMN "app_product_limit" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "app_audit_enabled" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "store_users"
  ADD COLUMN "is_primary" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "stock_flow_ids" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];

CREATE TABLE "stock_flows" (
  "id" SERIAL NOT NULL,
  "user_id" INTEGER NOT NULL,
  "store_id" INTEGER,
  "name" TEXT NOT NULL,
  "is_default" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "stock_flows_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "stock_levels" (
  "id" SERIAL NOT NULL,
  "flow_id" INTEGER NOT NULL,
  "product_id" INTEGER NOT NULL,
  "variant_key" TEXT NOT NULL DEFAULT 'product',
  "quantity" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "stock_levels_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "orders" ADD COLUMN "stock_flow_id" INTEGER;

CREATE INDEX "stock_flows_user_id_store_id_idx" ON "stock_flows"("user_id", "store_id");
CREATE UNIQUE INDEX "stock_flows_default_scope_key" ON "stock_flows"("user_id", COALESCE("store_id", 0)) WHERE "is_default";
CREATE UNIQUE INDEX "stock_levels_flow_id_product_id_variant_key_key" ON "stock_levels"("flow_id", "product_id", "variant_key");
CREATE INDEX "stock_levels_product_id_flow_id_idx" ON "stock_levels"("product_id", "flow_id");
CREATE INDEX "orders_stock_flow_id_idx" ON "orders"("stock_flow_id");
CREATE UNIQUE INDEX "store_users_one_primary_per_store" ON "store_users"("store_id") WHERE "is_primary";

ALTER TABLE "stock_flows" ADD CONSTRAINT "stock_flows_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stock_flows" ADD CONSTRAINT "stock_flows_store_id_fkey"
  FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_flow_id_fkey"
  FOREIGN KEY ("flow_id") REFERENCES "stock_flows"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "orders" ADD CONSTRAINT "orders_stock_flow_id_fkey"
  FOREIGN KEY ("stock_flow_id") REFERENCES "stock_flows"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "stock_flows" ("user_id", "store_id", "name", "is_default")
SELECT DISTINCT "user_id", "store_id", 'Estoque principal', true
FROM "products";

INSERT INTO "stock_levels" ("flow_id", "product_id", "variant_key", "quantity")
SELECT f."id", p."id", 'product', p."stock_quantity"
FROM "products" p
JOIN "stock_flows" f ON f."user_id" = p."user_id"
  AND f."is_default"
  AND f."store_id" IS NOT DISTINCT FROM p."store_id";

INSERT INTO "stock_levels" ("flow_id", "product_id", "variant_key", "quantity")
SELECT f."id", i."product_id", 'image:' || i."id"::TEXT, i."stock_quantity"
FROM "product_images" i
JOIN "products" p ON p."id" = i."product_id"
JOIN "stock_flows" f ON f."user_id" = p."user_id"
  AND f."is_default"
  AND f."store_id" IS NOT DISTINCT FROM p."store_id"
WHERE NOT i."is_primary";

UPDATE "orders" o
SET "stock_flow_id" = f."id"
FROM "stock_flows" f
WHERE f."user_id" = o."user_id"
  AND f."is_default"
  AND f."store_id" IS NOT DISTINCT FROM o."store_id";

UPDATE "stores" s
SET "app_product_limit" = CASE
      WHEN u."role" = 'admin' THEN 2147483647
      ELSE COALESCE((SELECT ps."catalog_products" FROM "plan_settings" ps WHERE ps."plan" = u."plan"), 0)
    END,
    "app_audit_enabled" = CASE
      WHEN u."role" = 'admin' THEN true
      ELSE COALESCE((SELECT ps."audit_instances" > 0 FROM "plan_settings" ps WHERE ps."plan" = u."plan"), false)
    END
FROM "users" u
WHERE u."id" = s."user_id";
