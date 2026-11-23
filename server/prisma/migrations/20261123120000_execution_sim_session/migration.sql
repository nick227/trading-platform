-- Simulator session per order (paper_daily: one decision per bot, symbol and session).
-- Additive only: one nullable column, no data rewritten.
-- Applied on Railway by the API pre-deploy `prisma db push --skip-generate` (no --accept-data-loss).
-- AlterTable
ALTER TABLE `Execution` ADD COLUMN `simSession` VARCHAR(191) NULL;
