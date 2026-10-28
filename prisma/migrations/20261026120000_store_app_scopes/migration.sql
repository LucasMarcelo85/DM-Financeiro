ALTER TABLE "instances" ADD COLUMN "store_id" INTEGER;

CREATE INDEX "instances_store_id_purpose_idx" ON "instances"("store_id", "purpose");

ALTER TABLE "instances"
ADD CONSTRAINT "instances_store_id_fkey"
FOREIGN KEY ("store_id") REFERENCES "stores"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "store_users"
ALTER COLUMN "perms" SET DEFAULT 'produtos,pedidos,clientes,arquivados,api,entregas,auditoria';

ALTER TABLE "order_customer_profiles"
ADD COLUMN "scope_key" TEXT NOT NULL DEFAULT 'main';

DROP INDEX "order_customer_profiles_user_id_customer_phone_key";
DROP INDEX "order_customer_profiles_user_id_updated_at_idx";

CREATE UNIQUE INDEX "order_customer_profiles_user_id_scope_key_customer_phone_key"
ON "order_customer_profiles"("user_id", "scope_key", "customer_phone");

CREATE INDEX "order_customer_profiles_user_id_scope_key_updated_at_idx"
ON "order_customer_profiles"("user_id", "scope_key", "updated_at");

INSERT INTO "order_customer_profiles"
("user_id", "scope_key", "customer_phone", "customer_name", "labels", "notes", "updated_at")
SELECT DISTINCT ON (o."user_id", o."store_id", o."customer_phone")
  o."user_id", 'store:' || o."store_id"::text, o."customer_phone", o."customer_name", ARRAY[]::TEXT[], '', o."created_at"
FROM "orders" o
WHERE o."store_id" IS NOT NULL AND o."deleted_at" IS NULL
ORDER BY o."user_id", o."store_id", o."customer_phone", o."created_at" DESC
ON CONFLICT ("user_id", "scope_key", "customer_phone") DO NOTHING;
