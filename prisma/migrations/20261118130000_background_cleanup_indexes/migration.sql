DROP INDEX IF EXISTS "instances_purpose_provider_idx";
DROP INDEX IF EXISTS "user_addons_paid_until_idx";
DROP INDEX IF EXISTS "verification_codes_expires_at_idx";
DROP INDEX IF EXISTS "orders_deleted_at_idx";
DROP INDEX IF EXISTS "ai_conversations_updated_at_idx";
DROP INDEX IF EXISTS "ai_messages_created_at_idx";

CREATE INDEX "instances_purpose_provider_idx"
ON "instances"("purpose", "provider");

CREATE INDEX "user_addons_paid_until_idx"
ON "user_addons"("paid_until");

CREATE INDEX "verification_codes_expires_at_idx"
ON "verification_codes"("expires_at");

CREATE INDEX "orders_deleted_at_idx"
ON "orders"("deleted_at");

CREATE INDEX "ai_conversations_updated_at_idx"
ON "ai_conversations"("updated_at");

CREATE INDEX "ai_messages_created_at_idx"
ON "ai_messages"("created_at");
