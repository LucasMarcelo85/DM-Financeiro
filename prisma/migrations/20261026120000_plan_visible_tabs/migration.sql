-- Abas do menu liberadas em cada plano (o administrador escolhe em Gerir planos). Planos que já existem continuam com todas.
ALTER TABLE "plan_settings" ADD COLUMN "visible_tabs" TEXT[] NOT NULL DEFAULT ARRAY['whatsapp', 'clientes', 'cobrancas', 'lembretes', 'contratos', 'auditoria', 'portfolio', 'produtos', 'pedidos']::TEXT[];
