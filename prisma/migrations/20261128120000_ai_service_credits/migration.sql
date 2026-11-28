ALTER TABLE "ai_agents" ALTER COLUMN "api_key" DROP NOT NULL;
ALTER TABLE "ai_messages" ADD COLUMN "cached_input_tokens" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ai_messages" ADD COLUMN "audio_seconds" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "ai_credit_wallets" (
    "user_id" INTEGER NOT NULL,
    "balance_micros" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ai_credit_wallets_pkey" PRIMARY KEY ("user_id")
);

CREATE TABLE "ai_credit_transactions" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "reference" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount_micros" BIGINT NOT NULL,
    "balance_after_micros" BIGINT NOT NULL,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "cached_input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "audio_seconds" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ai_credit_transactions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_credit_top_ups" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "order_nsu" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "slug" TEXT,
    "transaction_nsu" TEXT,
    "receipt_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paid_at" TIMESTAMP(3),
    CONSTRAINT "ai_credit_top_ups_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ai_credit_transactions_reference_key" ON "ai_credit_transactions"("reference");
CREATE INDEX "ai_credit_transactions_user_id_created_at_idx" ON "ai_credit_transactions"("user_id", "created_at");
CREATE UNIQUE INDEX "ai_credit_top_ups_order_nsu_key" ON "ai_credit_top_ups"("order_nsu");
CREATE INDEX "ai_credit_top_ups_user_id_created_at_idx" ON "ai_credit_top_ups"("user_id", "created_at");

ALTER TABLE "ai_credit_wallets" ADD CONSTRAINT "ai_credit_wallets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_credit_transactions" ADD CONSTRAINT "ai_credit_transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_credit_top_ups" ADD CONSTRAINT "ai_credit_top_ups_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
