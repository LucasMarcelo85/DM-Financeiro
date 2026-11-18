CREATE INDEX CONCURRENTLY IF NOT EXISTS "instances_purpose_provider_idx"
ON "instances"("purpose", "provider");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "user_addons_paid_until_idx"
ON "user_addons"("paid_until");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "verification_codes_expires_at_idx"
ON "verification_codes"("expires_at");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "orders_deleted_at_idx"
ON "orders"("deleted_at");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "ai_conversations_updated_at_idx"
ON "ai_conversations"("updated_at");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "ai_messages_created_at_idx"
ON "ai_messages"("created_at");
