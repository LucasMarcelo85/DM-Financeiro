CREATE TABLE "saved_media" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saved_media_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "saved_media_user_id_created_at_idx" ON "saved_media"("user_id", "created_at");

ALTER TABLE "saved_media" ADD CONSTRAINT "saved_media_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "schedules" ADD COLUMN "media_id" INTEGER;

ALTER TABLE "schedules" ADD CONSTRAINT "schedules_media_id_fkey" FOREIGN KEY ("media_id") REFERENCES "saved_media"("id") ON DELETE SET NULL ON UPDATE CASCADE;
