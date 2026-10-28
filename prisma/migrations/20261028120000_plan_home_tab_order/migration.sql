ALTER TABLE "plan_settings"
  ALTER COLUMN "visible_tabs" SET DEFAULT ARRAY['inicio', 'whatsapp', 'clientes', 'cobrancas', 'lembretes', 'contratos', 'auditoria', 'portfolio', 'produtos', 'pedidos', 'api']::TEXT[];

ALTER TABLE "trial_settings"
  ALTER COLUMN "visible_tabs" SET DEFAULT ARRAY['inicio', 'whatsapp', 'clientes', 'cobrancas', 'lembretes', 'contratos', 'auditoria', 'portfolio', 'produtos', 'pedidos', 'api']::TEXT[];

UPDATE "plan_settings"
SET "visible_tabs" = array_prepend('inicio', "visible_tabs")
WHERE NOT ('inicio' = ANY("visible_tabs"));

UPDATE "trial_settings"
SET "visible_tabs" = array_prepend('inicio', "visible_tabs")
WHERE NOT ('inicio' = ANY("visible_tabs"));
