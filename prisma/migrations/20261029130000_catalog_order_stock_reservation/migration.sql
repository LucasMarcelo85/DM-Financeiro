ALTER TABLE "orders"
  ADD COLUMN "stock_reserved" BOOLEAN NOT NULL DEFAULT true;

UPDATE "orders"
SET "payment_status" = 'paid',
    "payment_provider" = 'manual',
    "payment_id" = NULL,
    "payment_proof_url" = NULL,
    "paid_at" = "created_at"
WHERE "status" = 'atendido'
  AND "payment_status" <> 'paid';
