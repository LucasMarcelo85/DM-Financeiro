DELETE FROM "catalog_payment_connections"
WHERE "provider" <> 'infinitepay';

UPDATE "orders"
SET "payment_status" = 'failed',
    "payment_provider" = NULL,
    "payment_id" = NULL,
    "payment_proof_url" = NULL
WHERE "payment_status" = 'pending'
  AND "payment_provider" IS DISTINCT FROM 'infinitepay';

DROP TABLE "catalog_payment_oauth_states";

ALTER TABLE "catalog_payment_connections"
  DROP COLUMN "access_token",
  DROP COLUMN "refresh_token";
