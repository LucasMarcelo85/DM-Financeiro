-- AlterTable
ALTER TABLE "instances" ADD COLUMN     "last_event_at" TIMESTAMP(3),
ADD COLUMN     "last_sync_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "audit_chats" ADD COLUMN     "name_search" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "audit_messages" ADD COLUMN     "has_media" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "media_mime" TEXT,
ADD COLUMN     "media_name" TEXT,
ADD COLUMN     "media_ref" TEXT,
ADD COLUMN     "media_seconds" INTEGER,
ADD COLUMN     "seen_at" TIMESTAMP(3),
ADD COLUMN     "sender_jid" TEXT,
ADD COLUMN     "thumb" TEXT;

-- CreateTable
CREATE TABLE "audit_media" (
    "message_id" INTEGER NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_media_pkey" PRIMARY KEY ("message_id")
);

-- CreateTable
CREATE TABLE "audit_contacts" (
    "id" SERIAL NOT NULL,
    "instance_id" INTEGER NOT NULL,
    "jid" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "audit_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_messages_chat_id_from_me_seen_at_idx" ON "audit_messages"("chat_id", "from_me", "seen_at");

-- CreateIndex
CREATE UNIQUE INDEX "audit_contacts_instance_id_jid_key" ON "audit_contacts"("instance_id", "jid");

-- AddForeignKey
ALTER TABLE "audit_media" ADD CONSTRAINT "audit_media_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "audit_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_contacts" ADD CONSTRAINT "audit_contacts_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Dados que já existem: tudo conta como lido, exceto as últimas mensagens recebidas de cada conversa que tinha "não lidas".
UPDATE "audit_messages" SET "seen_at" = "created_at";
UPDATE "audit_messages" m SET "seen_at" = NULL
FROM (
  SELECT t.id FROM (
    SELECT m2.id, c.unread, row_number() OVER (PARTITION BY m2.chat_id ORDER BY m2.ts DESC, m2.id DESC) AS rn
    FROM "audit_messages" m2 JOIN "audit_chats" c ON c.id = m2.chat_id
    WHERE m2.from_me = false AND c.unread > 0
  ) t WHERE t.rn <= t.unread
) x WHERE m.id = x.id;
-- Nome sem acento e em minúsculas, para a busca por nome ignorar acentos ("joao" acha "João").
UPDATE "audit_chats" SET "name_search" = lower(translate(coalesce("name", ''), 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑáàâãäéèêëíìîïóòôõöúùûüçñ', 'AAAAAEEEEIIIIOOOOOUUUUCNaaaaaeeeeiiiiooooouuuucn'));
