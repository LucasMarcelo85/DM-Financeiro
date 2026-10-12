-- CreateEnum
CREATE TYPE "UserKind" AS ENUM ('PF', 'PJ');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('usuario', 'admin');

-- CreateEnum
CREATE TYPE "Plan" AS ENUM ('bronze', 'prata', 'ouro');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('pending', 'paid');

-- CreateEnum
CREATE TYPE "MessageKind" AS ENUM ('cobranca', 'lembrete');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('sent', 'partial', 'failed');

-- CreateEnum
CREATE TYPE "Recurrence" AS ENUM ('avulsa', 'mensal');

-- CreateEnum
CREATE TYPE "ScheduleStatus" AS ENUM ('ativa', 'pausada', 'concluida');

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "kind" "UserKind" NOT NULL,
    "name" TEXT NOT NULL,
    "document" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL DEFAULT '',
    "password_hash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'usuario',
    "plan" "Plan" NOT NULL DEFAULT 'bronze',
    "trial_ends_at" TIMESTAMP(3) NOT NULL,
    "access_until" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "instances" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "instances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "order_nsu" TEXT NOT NULL,
    "plan" "Plan" NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'pending',
    "slug" TEXT,
    "transaction_nsu" TEXT,
    "receipt_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paid_at" TIMESTAMP(3),

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contacts" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedules" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "contact_id" INTEGER NOT NULL,
    "instance_id" INTEGER,
    "kind" "MessageKind" NOT NULL,
    "recurrence" "Recurrence" NOT NULL,
    "status" "ScheduleStatus" NOT NULL DEFAULT 'ativa',
    "amount_cents" INTEGER,
    "text" TEXT NOT NULL,
    "extra" TEXT,
    "due_date" DATE NOT NULL,
    "next_due_date" DATE,
    "days_before" INTEGER NOT NULL DEFAULT 0,
    "send_time" TEXT NOT NULL,
    "next_run_at" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_run_at" TIMESTAMP(3),
    "last_status" "MessageStatus",
    "last_error" TEXT,
    "sent_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "contact_id" INTEGER,
    "schedule_id" INTEGER,
    "contact_name" TEXT,
    "instance_name" TEXT NOT NULL,
    "kind" "MessageKind" NOT NULL,
    "number" TEXT NOT NULL,
    "has_extra" BOOLEAN NOT NULL DEFAULT false,
    "status" "MessageStatus" NOT NULL,
    "error" TEXT,
    "automatic" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_document_key" ON "users"("document");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "instances_name_key" ON "instances"("name");

-- CreateIndex
CREATE INDEX "instances_user_id_idx" ON "instances"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_order_nsu_key" ON "payments"("order_nsu");

-- CreateIndex
CREATE INDEX "payments_user_id_idx" ON "payments"("user_id");

-- CreateIndex
CREATE INDEX "contacts_user_id_name_idx" ON "contacts"("user_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "contacts_user_id_phone_key" ON "contacts"("user_id", "phone");

-- CreateIndex
CREATE INDEX "schedules_user_id_kind_idx" ON "schedules"("user_id", "kind");

-- CreateIndex
CREATE INDEX "schedules_status_next_run_at_idx" ON "schedules"("status", "next_run_at");

-- CreateIndex
CREATE INDEX "messages_user_id_created_at_idx" ON "messages"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "instances" ADD CONSTRAINT "instances_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "instances"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "schedules"("id") ON DELETE SET NULL ON UPDATE CASCADE;
