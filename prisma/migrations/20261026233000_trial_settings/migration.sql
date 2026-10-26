CREATE TABLE "trial_settings" (
  "id" INTEGER NOT NULL DEFAULT 1,
  "days" INTEGER NOT NULL DEFAULT 3,
  "instances" INTEGER NOT NULL DEFAULT 1,
  "audit_instances" INTEGER NOT NULL DEFAULT 1,
  "contracts" INTEGER NOT NULL DEFAULT 2,
  "portfolios" INTEGER NOT NULL DEFAULT 1,
  "catalog_products" INTEGER NOT NULL DEFAULT 0,
  "audit_send" BOOLEAN NOT NULL DEFAULT false,
  "visible_tabs" TEXT[] NOT NULL DEFAULT ARRAY['whatsapp','clientes','cobrancas','lembretes','contratos','auditoria','portfolio','produtos','pedidos']::TEXT[],
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "trial_settings_pkey" PRIMARY KEY ("id")
);

INSERT INTO "trial_settings" ("id", "days", "instances", "audit_instances", "contracts", "portfolios", "catalog_products", "audit_send", "visible_tabs")
VALUES (1, 3, 1, 1, 2, 1, 0, false, ARRAY['whatsapp','clientes','cobrancas','lembretes','contratos','auditoria','portfolio','produtos','pedidos']::TEXT[])
ON CONFLICT ("id") DO NOTHING;
