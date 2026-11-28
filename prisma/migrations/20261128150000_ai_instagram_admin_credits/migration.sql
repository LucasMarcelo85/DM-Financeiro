ALTER TABLE "ai_agents"
  ADD COLUMN "instagram_account_id" INTEGER,
  ADD COLUMN "respond_instagram_direct" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "respond_instagram_comments" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "ai_conversations" ADD COLUMN "channel" TEXT NOT NULL DEFAULT 'whatsapp';
DROP INDEX IF EXISTS "ai_conversations_agent_id_phone_key";
CREATE UNIQUE INDEX "ai_conversations_agent_id_channel_phone_key"
  ON "ai_conversations"("agent_id", "channel", "phone");

ALTER TABLE "ai_credit_transactions"
  ADD COLUMN "admin_user_id" INTEGER,
  ADD COLUMN "note" TEXT;

CREATE TABLE "ai_instagram_accounts" (
  "id" SERIAL NOT NULL,
  "user_id" INTEGER NOT NULL,
  "store_id" INTEGER,
  "scope_key" TEXT NOT NULL,
  "instagram_user_id" TEXT NOT NULL,
  "username" TEXT NOT NULL,
  "access_token" TEXT NOT NULL,
  "permissions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "expires_at" TIMESTAMP(3),
  "webhook_subscribed" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ai_instagram_accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_instagram_oauth_states" (
  "state" TEXT NOT NULL,
  "user_id" INTEGER NOT NULL,
  "store_id" INTEGER,
  "return_path" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_instagram_oauth_states_pkey" PRIMARY KEY ("state")
);

CREATE UNIQUE INDEX "ai_instagram_accounts_scope_key_key" ON "ai_instagram_accounts"("scope_key");
CREATE UNIQUE INDEX "ai_instagram_accounts_instagram_user_id_key" ON "ai_instagram_accounts"("instagram_user_id");
CREATE INDEX "ai_instagram_accounts_user_id_store_id_idx" ON "ai_instagram_accounts"("user_id", "store_id");
CREATE INDEX "ai_instagram_oauth_states_expires_at_idx" ON "ai_instagram_oauth_states"("expires_at");

ALTER TABLE "ai_agents"
  ADD CONSTRAINT "ai_agents_instagram_account_id_fkey"
  FOREIGN KEY ("instagram_account_id") REFERENCES "ai_instagram_accounts"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ai_instagram_accounts"
  ADD CONSTRAINT "ai_instagram_accounts_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_instagram_accounts"
  ADD CONSTRAINT "ai_instagram_accounts_store_id_fkey"
  FOREIGN KEY ("store_id") REFERENCES "stores"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_instagram_oauth_states"
  ADD CONSTRAINT "ai_instagram_oauth_states_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_instagram_oauth_states"
  ADD CONSTRAINT "ai_instagram_oauth_states_store_id_fkey"
  FOREIGN KEY ("store_id") REFERENCES "stores"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
