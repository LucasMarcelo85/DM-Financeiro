-- AlterTable
ALTER TABLE "users" ADD COLUMN "portfolio_slug" TEXT;

-- CreateTable
CREATE TABLE "portfolios" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "is_main" BOOLEAN NOT NULL DEFAULT false,
    "data" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "portfolios_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_portfolio_slug_key" ON "users"("portfolio_slug");

-- CreateIndex
CREATE UNIQUE INDEX "portfolios_user_id_slug_key" ON "portfolios"("user_id", "slug");

-- CreateIndex
CREATE INDEX "portfolios_user_id_updated_at_idx" ON "portfolios"("user_id", "updated_at");

-- AddForeignKey
ALTER TABLE "portfolios" ADD CONSTRAINT "portfolios_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
