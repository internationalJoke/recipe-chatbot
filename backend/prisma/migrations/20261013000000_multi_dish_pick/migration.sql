-- The user can pick several dish cards at once.
ALTER TABLE "Message" ADD COLUMN "selectedDishIds" VARCHAR(64)[] NOT NULL DEFAULT ARRAY[]::VARCHAR(64)[];
UPDATE "Message" SET "selectedDishIds" = ARRAY["selectedDishId"] WHERE "selectedDishId" IS NOT NULL;
ALTER TABLE "Message" DROP COLUMN "selectedDishId";
