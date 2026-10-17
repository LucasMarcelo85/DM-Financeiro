-- CreateEnum
CREATE TYPE "InstancePurpose" AS ENUM ('envio', 'auditoria');

-- CreateEnum
CREATE TYPE "InstanceProvider" AS ENUM ('evolution', 'meta');

-- AlterTable
ALTER TABLE "instances" ADD COLUMN     "label" TEXT,
ADD COLUMN     "meta_access_token" TEXT,
ADD COLUMN     "meta_app_secret" TEXT,
ADD COLUMN     "meta_business_id" TEXT,
ADD COLUMN     "meta_phone_display" TEXT,
ADD COLUMN     "meta_phone_number_id" TEXT,
ADD COLUMN     "meta_verify_token" TEXT,
ADD COLUMN     "provider" "InstanceProvider" NOT NULL DEFAULT 'evolution',
ADD COLUMN     "purpose" "InstancePurpose" NOT NULL DEFAULT 'envio';

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "days" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "period" TEXT NOT NULL DEFAULT 'mensal';

-- DropIndex
DROP INDEX "instances_user_id_idx";

-- CreateTable
CREATE TABLE "audit_chats" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "instance_id" INTEGER NOT NULL,
    "jid" TEXT NOT NULL,
    "is_group" BOOLEAN NOT NULL DEFAULT false,
    "name" TEXT,
    "phone" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "note_updated_at" TIMESTAMP(3),
    "last_message_at" TIMESTAMP(3) NOT NULL,
    "last_text" TEXT NOT NULL DEFAULT '',
    "last_from_me" BOOLEAN NOT NULL DEFAULT false,
    "unread" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_chats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_messages" (
    "id" SERIAL NOT NULL,
    "chat_id" INTEGER NOT NULL,
    "external_id" TEXT NOT NULL,
    "from_me" BOOLEAN NOT NULL DEFAULT false,
    "sender" TEXT,
    "type" TEXT NOT NULL DEFAULT 'text',
    "body" TEXT NOT NULL DEFAULT '',
    "search" TEXT NOT NULL DEFAULT '',
    "status" TEXT,
    "ts" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_labels" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#1f55a6',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_labels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_chat_labels" (
    "chat_id" INTEGER NOT NULL,
    "label_id" INTEGER NOT NULL,

    CONSTRAINT "audit_chat_labels_pkey" PRIMARY KEY ("chat_id","label_id")
);

-- CreateIndex
CREATE INDEX "audit_chats_user_id_last_message_at_idx" ON "audit_chats"("user_id", "last_message_at");

-- CreateIndex
CREATE UNIQUE INDEX "audit_chats_instance_id_jid_key" ON "audit_chats"("instance_id", "jid");

-- CreateIndex
CREATE INDEX "audit_messages_chat_id_ts_idx" ON "audit_messages"("chat_id", "ts");

-- CreateIndex
CREATE UNIQUE INDEX "audit_messages_chat_id_external_id_key" ON "audit_messages"("chat_id", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "audit_labels_user_id_name_key" ON "audit_labels"("user_id", "name");

-- CreateIndex
CREATE INDEX "audit_chat_labels_label_id_idx" ON "audit_chat_labels"("label_id");

-- CreateIndex
CREATE INDEX "instances_user_id_purpose_idx" ON "instances"("user_id", "purpose");

-- CreateIndex
CREATE INDEX "instances_meta_phone_number_id_idx" ON "instances"("meta_phone_number_id");

-- AddForeignKey
ALTER TABLE "audit_chats" ADD CONSTRAINT "audit_chats_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_chats" ADD CONSTRAINT "audit_chats_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_messages" ADD CONSTRAINT "audit_messages_chat_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "audit_chats"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_labels" ADD CONSTRAINT "audit_labels_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_chat_labels" ADD CONSTRAINT "audit_chat_labels_chat_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "audit_chats"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_chat_labels" ADD CONSTRAINT "audit_chat_labels_label_id_fkey" FOREIGN KEY ("label_id") REFERENCES "audit_labels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
