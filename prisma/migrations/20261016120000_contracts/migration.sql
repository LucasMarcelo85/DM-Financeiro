-- CreateTable
CREATE TABLE "contracts" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "page_count" INTEGER NOT NULL DEFAULT 1,
    "data" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contracts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contracts_user_id_updated_at_idx" ON "contracts"("user_id", "updated_at");

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
