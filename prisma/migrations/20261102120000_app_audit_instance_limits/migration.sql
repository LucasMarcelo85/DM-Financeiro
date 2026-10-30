ALTER TABLE "stores"
  ADD COLUMN "app_audit_instance_limit" INTEGER NOT NULL DEFAULT 0;

UPDATE "stores" s
SET "app_audit_instance_limit" = COALESCE((
  SELECT COUNT(*)::INTEGER
  FROM "instances" i
  WHERE i."user_id" = s."user_id"
    AND i."purpose" = 'auditoria'
    AND i."audit_scope" = 'store:' || s."id"::TEXT
), 0)
WHERE s."app_audit_enabled" = true;
