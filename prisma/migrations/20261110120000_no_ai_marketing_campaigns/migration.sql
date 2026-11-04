CREATE TABLE "no_ai_marketing_campaigns" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "instance_id" INTEGER NOT NULL,
    "message" TEXT NOT NULL DEFAULT '',
    "media_data" BYTEA,
    "media_mime_type" TEXT,
    "media_file_name" TEXT,
    "consent_confirmed" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'running',
    "interval_ms" INTEGER NOT NULL,
    "next_run_at" TIMESTAMP(3),
    "total" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "no_ai_marketing_campaigns_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "no_ai_marketing_campaign_items" (
    "id" SERIAL NOT NULL,
    "campaign_id" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "phone" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error" TEXT NOT NULL DEFAULT '',
    "sent_at" TIMESTAMP(3),

    CONSTRAINT "no_ai_marketing_campaign_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "no_ai_marketing_campaigns_user_id_created_at_idx" ON "no_ai_marketing_campaigns"("user_id", "created_at");
CREATE INDEX "no_ai_marketing_campaigns_status_next_run_at_idx" ON "no_ai_marketing_campaigns"("status", "next_run_at");
CREATE INDEX "no_ai_marketing_campaign_items_campaign_id_status_position_idx" ON "no_ai_marketing_campaign_items"("campaign_id", "status", "position");

ALTER TABLE "no_ai_marketing_campaigns" ADD CONSTRAINT "no_ai_marketing_campaigns_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "no_ai_marketing_campaigns" ADD CONSTRAINT "no_ai_marketing_campaigns_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "no_ai_marketing_campaign_items" ADD CONSTRAINT "no_ai_marketing_campaign_items_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "no_ai_marketing_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
