CREATE TABLE "portfolio_push_subscriptions" (
    "id" SERIAL NOT NULL,
    "portfolio_id" INTEGER NOT NULL,
    "endpoint" TEXT NOT NULL,
    "subscription" JSONB NOT NULL,
    "url" TEXT NOT NULL DEFAULT '/',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "portfolio_push_subscriptions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "portfolio_push_subscriptions_portfolio_id_endpoint_key"
ON "portfolio_push_subscriptions"("portfolio_id", "endpoint");

CREATE INDEX "portfolio_push_subscriptions_portfolio_id_idx"
ON "portfolio_push_subscriptions"("portfolio_id");

ALTER TABLE "portfolio_push_subscriptions"
ADD CONSTRAINT "portfolio_push_subscriptions_portfolio_id_fkey"
FOREIGN KEY ("portfolio_id") REFERENCES "portfolios"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
