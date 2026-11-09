ALTER TABLE "ai_agents"
  ADD COLUMN "store_id" INTEGER,
  ADD COLUMN "data_access" JSONB NOT NULL DEFAULT '{"orders":true,"products":false,"billing":false}';

UPDATE "ai_agents" AS agent
SET "store_id" = instance."store_id"
FROM "instances" AS instance
WHERE agent."instance_id" = instance."id"
  AND instance."store_id" IS NOT NULL;

CREATE INDEX "ai_agents_user_id_store_id_idx" ON "ai_agents"("user_id", "store_id");

ALTER TABLE "ai_actions"
  ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'notify',
  ADD COLUMN "config" JSONB NOT NULL DEFAULT '{}';

ALTER TABLE "orders"
  ADD COLUMN "ai_conversation_id" INTEGER;

ALTER TABLE "ai_conversations"
  ADD COLUMN "store_id" INTEGER,
  ADD COLUMN "labels" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "note" TEXT NOT NULL DEFAULT '';

UPDATE "ai_conversations" AS conversation
SET "store_id" = agent."store_id"
FROM "ai_agents" AS agent
WHERE conversation."agent_id" = agent."id"
  AND agent."store_id" IS NOT NULL;

UPDATE "ai_conversations" AS conversation
SET "store_id" = substring("users"."email" FROM '^ws-([0-9]+)@')::INTEGER
FROM "users"
WHERE conversation."user_id" = "users"."id"
  AND conversation."store_id" IS NULL
  AND "users"."email" ~ '^ws-[0-9]+@workspace[.]invalid$';

CREATE INDEX "ai_conversations_user_id_store_id_updated_at_idx"
  ON "ai_conversations"("user_id", "store_id", "updated_at");
