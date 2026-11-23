-- Preferências de produtos por loja
CREATE TABLE "product_store_preferences" (
    "store_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "categories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "variation_types" TEXT[] DEFAULT ARRAY['Cor', 'Tamanho', 'Litros']::TEXT[],
    "price_labels" TEXT[] DEFAULT ARRAY['Varejo', 'Atacarejo', 'Atacado', 'Mensal', 'Semestral', 'Anual']::TEXT[],
    "price_rules" JSONB NOT NULL DEFAULT '[]',
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_store_preferences_pkey" PRIMARY KEY ("store_id")
);

CREATE INDEX "product_store_preferences_user_id_idx" ON "product_store_preferences"("user_id");

ALTER TABLE "product_store_preferences" ADD CONSTRAINT "product_store_preferences_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;