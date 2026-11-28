-- AlterTable: Execution (additive — safe for prisma db push --skip-generate)
ALTER TABLE `Execution`
  ADD COLUMN `version` INTEGER NOT NULL DEFAULT 0;
