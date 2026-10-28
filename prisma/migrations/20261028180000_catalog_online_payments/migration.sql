ALTER TABLE "orders"
  ADD COLUMN "payment_status" TEXT NOT NULL DEFAULT 'unpaid',
  ADD COLUMN "payment_provider" TEXT,
  ADD COLUMN "payment_id" TEXT,
  ADD COLUMN "payment_proof_url" TEXT,
  ADD COLUMN "paid_at" TIMESTAMP(3);

CREATE TABLE "catalog_payment_connections" (
  "id" SERIAL NOT NULL,
  "user_id" INTEGER NOT NULL,
  "store_id" INTEGER,
  "scope_key" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "account_id" TEXT NOT NULL,
  "access_token" TEXT,
  "refresh_token" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "catalog_payment_connections_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "catalog_payment_connections_user_id_scope_key_provider_key"
  ON "catalog_payment_connections"("user_id", "scope_key", "provider");
CREATE INDEX "catalog_payment_connections_provider_account_id_idx"
  ON "catalog_payment_connections"("provider", "account_id");
ALTER TABLE "catalog_payment_connections" ADD CONSTRAINT "catalog_payment_connections_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "catalog_payment_oauth_states" (
  "id" SERIAL NOT NULL,
  "state_hash" TEXT NOT NULL,
  "user_id" INTEGER NOT NULL,
  "store_id" INTEGER,
  "scope_key" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "catalog_payment_oauth_states_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "catalog_payment_oauth_states_state_hash_key"
  ON "catalog_payment_oauth_states"("state_hash");
CREATE INDEX "catalog_payment_oauth_states_expires_at_idx"
  ON "catalog_payment_oauth_states"("expires_at");
ALTER TABLE "catalog_payment_oauth_states" ADD CONSTRAINT "catalog_payment_oauth_states_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
