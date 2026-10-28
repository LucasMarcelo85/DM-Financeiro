ALTER TABLE "product_images"
ADD COLUMN "is_primary" BOOLEAN NOT NULL DEFAULT false;

WITH ranked_images AS (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "product_id" ORDER BY "position", "id") AS row_number
  FROM "product_images"
)
UPDATE "product_images"
SET "is_primary" = true
FROM ranked_images
WHERE "product_images"."id" = ranked_images."id"
  AND ranked_images.row_number = 1;
