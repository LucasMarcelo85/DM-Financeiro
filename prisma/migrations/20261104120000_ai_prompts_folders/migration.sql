CREATE TABLE "ai_prompts" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'atendimento',
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ai_prompts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_contact_folders" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ai_contact_folders_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_folder_contacts" (
    "id" SERIAL NOT NULL,
    "folder_id" INTEGER NOT NULL,
    "phone" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ai_folder_contacts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ai_prompts_user_id_mode_idx" ON "ai_prompts"("user_id", "mode");
CREATE UNIQUE INDEX "ai_contact_folders_user_id_name_key" ON "ai_contact_folders"("user_id", "name");
CREATE UNIQUE INDEX "ai_folder_contacts_folder_id_phone_key" ON "ai_folder_contacts"("folder_id", "phone");

ALTER TABLE "ai_prompts" ADD CONSTRAINT "ai_prompts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_contact_folders" ADD CONSTRAINT "ai_contact_folders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_folder_contacts" ADD CONSTRAINT "ai_folder_contacts_folder_id_fkey" FOREIGN KEY ("folder_id") REFERENCES "ai_contact_folders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
