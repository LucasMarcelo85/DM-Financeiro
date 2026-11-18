ALTER TYPE "Recurrence" ADD VALUE 'semanal';

ALTER TABLE "schedules"
ADD COLUMN "week_days" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];
