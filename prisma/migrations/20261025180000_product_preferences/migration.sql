CREATE TABLE "product_preferences" (
    "user_id" INTEGER NOT NULL,
    "categories" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "variation_types" TEXT[] NOT NULL DEFAULT ARRAY['Cor', 'Tamanho', 'Litros']::TEXT[],
    "price_labels" TEXT[] NOT NULL DEFAULT ARRAY['Varejo', 'Atacarejo', 'Atacado', 'Mensal', 'Semestral', 'Anual']::TEXT[],
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_preferences_pkey" PRIMARY KEY ("user_id")
);

ALTER TABLE "product_preferences"
ADD CONSTRAINT "product_preferences_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
