ALTER TABLE "orders" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'catalog';
ALTER TABLE "orders" ADD COLUMN "payment_method" TEXT;
ALTER TABLE "orders" ADD COLUMN "payment_breakdown" JSONB;
ALTER TABLE "orders" ADD COLUMN "discount_cents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "orders" ADD COLUMN "surcharge_cents" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "orders_user_id_store_id_source_created_at_idx" ON "orders"("user_id", "store_id", "source", "created_at");

CREATE TABLE "pos_settings" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "store_id" INTEGER,
    "scope_key" TEXT NOT NULL,
    "receipt" JSONB NOT NULL DEFAULT '{}',
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pos_settings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "pos_settings_user_id_scope_key_key" ON "pos_settings"("user_id", "scope_key");
CREATE INDEX "pos_settings_store_id_idx" ON "pos_settings"("store_id");

ALTER TABLE "pos_settings" ADD CONSTRAINT "pos_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pos_settings" ADD CONSTRAINT "pos_settings_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "store_users" ALTER COLUMN "perms" SET DEFAULT 'produtos,pedidos,clientes,arquivados,estrategia,pdv,api,entregas,auditoria';
