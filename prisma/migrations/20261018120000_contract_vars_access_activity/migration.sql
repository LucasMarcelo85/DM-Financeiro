-- AlterTable
ALTER TABLE "contacts" ADD COLUMN     "city" TEXT,
ADD COLUMN     "complement" TEXT,
ADD COLUMN     "district" TEXT,
ADD COLUMN     "document" TEXT,
ADD COLUMN     "number" TEXT,
ADD COLUMN     "state" TEXT,
ADD COLUMN     "street" TEXT,
ADD COLUMN     "zip" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "last_activity" TEXT,
ADD COLUMN     "last_activity_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "access_events" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "admin_id" INTEGER,
    "admin_name" TEXT NOT NULL DEFAULT '',
    "kind" TEXT NOT NULL,
    "days" INTEGER NOT NULL,
    "prev_access_until" TIMESTAMP(3),
    "prev_trial_ends_at" TIMESTAMP(3) NOT NULL,
    "new_access_until" TIMESTAMP(3),
    "new_trial_ends_at" TIMESTAMP(3) NOT NULL,
    "reverted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "access_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "access_events_user_id_created_at_idx" ON "access_events"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "access_events" ADD CONSTRAINT "access_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
