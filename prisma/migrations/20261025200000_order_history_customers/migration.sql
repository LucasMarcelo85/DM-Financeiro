ALTER TABLE "orders" ADD COLUMN "deleted_at" TIMESTAMP(3);

CREATE INDEX "orders_user_id_deleted_at_created_at_idx" ON "orders"("user_id", "deleted_at", "created_at");

CREATE TABLE "order_customer_profiles" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "customer_phone" TEXT NOT NULL,
    "customer_name" TEXT NOT NULL,
    "labels" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT NOT NULL DEFAULT '',
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_customer_profiles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "order_customer_profiles_user_id_customer_phone_key" ON "order_customer_profiles"("user_id", "customer_phone");
CREATE INDEX "order_customer_profiles_user_id_updated_at_idx" ON "order_customer_profiles"("user_id", "updated_at");

ALTER TABLE "order_customer_profiles" ADD CONSTRAINT "order_customer_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
