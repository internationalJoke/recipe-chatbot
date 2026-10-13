-- AlterTable
ALTER TABLE "Message" ADD COLUMN "dishes" JSONB,
ADD COLUMN "selectedDishId" VARCHAR(64);
