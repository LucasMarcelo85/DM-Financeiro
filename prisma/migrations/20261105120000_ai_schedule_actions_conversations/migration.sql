ALTER TABLE "ai_agents" ADD COLUMN "schedule" JSONB NOT NULL DEFAULT '{}';

CREATE TABLE "ai_actions" (
    "id" SERIAL NOT NULL,
    "agent_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "target_phone" TEXT NOT NULL,
    "message" TEXT NOT NULL DEFAULT '',
    "pause_after" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ai_actions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ai_actions_agent_id_idx" ON "ai_actions"("agent_id");
ALTER TABLE "ai_actions" ADD CONSTRAINT "ai_actions_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "ai_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Conversas passam a ter dono próprio e sobrevivem à exclusão do agente.
ALTER TABLE "ai_conversations" ADD COLUMN "user_id" INTEGER;
ALTER TABLE "ai_conversations" ADD COLUMN "agent_name" TEXT NOT NULL DEFAULT '';
ALTER TABLE "ai_conversations" ADD COLUMN "agent_mode" TEXT NOT NULL DEFAULT 'atendimento';
ALTER TABLE "ai_conversations" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'active';
ALTER TABLE "ai_conversations" ADD COLUMN "interrupted_at" TIMESTAMP(3);

UPDATE "ai_conversations" c
SET "user_id" = a."user_id", "agent_name" = a."name", "agent_mode" = a."mode"
FROM "ai_agents" a
WHERE a."id" = c."agent_id";

ALTER TABLE "ai_conversations" ALTER COLUMN "user_id" SET NOT NULL;
ALTER TABLE "ai_conversations" ALTER COLUMN "agent_id" DROP NOT NULL;
ALTER TABLE "ai_conversations" DROP CONSTRAINT "ai_conversations_agent_id_fkey";
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "ai_agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "ai_conversations_user_id_updated_at_idx" ON "ai_conversations"("user_id", "updated_at");
