ALTER TABLE "stores" ADD COLUMN "app_limits" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "store_users" ADD COLUMN "perm_actions" JSONB NOT NULL DEFAULT '{}';
