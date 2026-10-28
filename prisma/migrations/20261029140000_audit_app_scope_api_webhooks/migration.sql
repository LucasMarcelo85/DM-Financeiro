ALTER TABLE "instances"
  ADD COLUMN "audit_scope" TEXT NOT NULL DEFAULT 'main';
CREATE INDEX "instances_user_id_purpose_audit_scope_idx"
  ON "instances"("user_id", "purpose", "audit_scope");

ALTER TABLE "audit_labels"
  ADD COLUMN "audit_scope" TEXT NOT NULL DEFAULT 'main';
DROP INDEX "audit_labels_user_id_name_key";
CREATE UNIQUE INDEX "audit_labels_user_id_audit_scope_name_key"
  ON "audit_labels"("user_id", "audit_scope", "name");

CREATE TABLE "api_webhook_endpoints" (
  "id" SERIAL NOT NULL,
  "user_id" INTEGER NOT NULL,
  "store_id" INTEGER,
  "name" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "events" JSONB NOT NULL,
  "secret" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "api_webhook_endpoints_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "api_webhook_deliveries" (
  "id" SERIAL NOT NULL,
  "endpoint_id" INTEGER NOT NULL,
  "event_id" TEXT NOT NULL,
  "event" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_status" INTEGER,
  "last_error" TEXT,
  "delivered_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "api_webhook_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "api_webhook_endpoints_user_id_store_id_idx"
  ON "api_webhook_endpoints"("user_id", "store_id");
CREATE INDEX "api_webhook_deliveries_status_next_attempt_at_idx"
  ON "api_webhook_deliveries"("status", "next_attempt_at");
CREATE INDEX "api_webhook_deliveries_endpoint_id_created_at_idx"
  ON "api_webhook_deliveries"("endpoint_id", "created_at");

ALTER TABLE "api_webhook_endpoints"
  ADD CONSTRAINT "api_webhook_endpoints_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "api_webhook_deliveries"
  ADD CONSTRAINT "api_webhook_deliveries_endpoint_id_fkey"
  FOREIGN KEY ("endpoint_id") REFERENCES "api_webhook_endpoints"("id") ON DELETE CASCADE ON UPDATE CASCADE;
