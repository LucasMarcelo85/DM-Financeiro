CREATE TABLE "api_tokens" (
  "id" SERIAL NOT NULL,
  "user_id" INTEGER NOT NULL,
  "store_id" INTEGER,
  "name" TEXT NOT NULL,
  "prefix" TEXT NOT NULL,
  "token_hash" TEXT NOT NULL,
  "last_used_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "api_tokens_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "api_tokens_token_hash_key" ON "api_tokens"("token_hash");
CREATE INDEX "api_tokens_user_id_idx" ON "api_tokens"("user_id");
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "plan_settings" ALTER COLUMN "visible_tabs" SET DEFAULT ARRAY['whatsapp','clientes','cobrancas','lembretes','contratos','auditoria','portfolio','produtos','pedidos','api']::TEXT[];
ALTER TABLE "trial_settings" ALTER COLUMN "visible_tabs" SET DEFAULT ARRAY['whatsapp','clientes','cobrancas','lembretes','contratos','auditoria','portfolio','produtos','pedidos','api']::TEXT[];
UPDATE "plan_settings" SET "visible_tabs" = array_append("visible_tabs", 'api') WHERE NOT ('api' = ANY("visible_tabs"));
UPDATE "trial_settings" SET "visible_tabs" = array_append("visible_tabs", 'api') WHERE NOT ('api' = ANY("visible_tabs"));