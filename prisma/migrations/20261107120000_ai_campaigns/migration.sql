CREATE TABLE "ai_campaigns" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "agent_id" INTEGER NOT NULL,
    "message" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "start_at" TIMESTAMP(3) NOT NULL,
    "end_at" TIMESTAMP(3) NOT NULL,
    "interval_ms" INTEGER NOT NULL,
    "speed" INTEGER NOT NULL DEFAULT 1,
    "next_run_at" TIMESTAMP(3),
    "total" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "ai_campaigns_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_campaign_items" (
    "id" SERIAL NOT NULL,
    "campaign_id" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "phone" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error" TEXT NOT NULL DEFAULT '',
    "sent_at" TIMESTAMP(3),

    CONSTRAINT "ai_campaign_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ai_campaigns_user_id_created_at_idx" ON "ai_campaigns"("user_id", "created_at");
CREATE INDEX "ai_campaigns_agent_id_status_idx" ON "ai_campaigns"("agent_id", "status");
CREATE INDEX "ai_campaigns_status_next_run_at_idx" ON "ai_campaigns"("status", "next_run_at");
CREATE INDEX "ai_campaign_items_campaign_id_status_position_idx" ON "ai_campaign_items"("campaign_id", "status", "position");

ALTER TABLE "ai_campaigns" ADD CONSTRAINT "ai_campaigns_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "ai_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_campaign_items" ADD CONSTRAINT "ai_campaign_items_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "ai_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
