CREATE TABLE "order_strategy_records" (
    "id" SERIAL NOT NULL,
    "order_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "store_id" INTEGER,
    "customer_phone" TEXT NOT NULL,
    "total_cents" INTEGER NOT NULL,
    "paid" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_strategy_records_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "order_strategy_records_order_id_key" ON "order_strategy_records"("order_id");
CREATE INDEX "order_strategy_records_user_id_store_id_created_at_idx" ON "order_strategy_records"("user_id", "store_id", "created_at");
CREATE INDEX "order_strategy_customer_recent_idx" ON "order_strategy_records"("user_id", "store_id", "customer_phone", "created_at");

ALTER TABLE "order_strategy_records" ADD CONSTRAINT "order_strategy_records_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "order_strategy_records" ADD CONSTRAINT "order_strategy_records_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "order_strategy_records" ("order_id", "user_id", "store_id", "customer_phone", "total_cents", "paid", "created_at")
SELECT "id", "user_id", "store_id", "customer_phone", "total_cents", "payment_status" = 'paid', "created_at"
FROM "orders"
ON CONFLICT ("order_id") DO NOTHING;

ALTER TABLE "store_users" ALTER COLUMN "perms" SET DEFAULT 'produtos,pedidos,clientes,arquivados,estrategia,api,entregas,auditoria';
UPDATE "store_users"
SET "perms" = concat_ws(',', NULLIF("perms", ''), 'estrategia')
WHERE position(',pedidos,' IN concat(',', "perms", ',')) > 0
  AND position(',estrategia,' IN concat(',', "perms", ',')) = 0;
