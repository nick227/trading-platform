-- Structured order refusals. Additive only: one nullable column, no data rewritten.
-- Applied on Railway by the API pre-deploy `prisma db push --skip-generate` (no --accept-data-loss).
-- `Execution.status` is a plain string, so the new value 'refused' needs no DDL.
-- Historical refusals (status 'cancelled', cancelReason 'refused:<reason>') stay valid as-is:
-- every refusal query matches both shapes. Optional, reversible backfill:
--   node scripts/backfillRefusedStatus.mjs            (dry run)
--   node scripts/backfillRefusedStatus.mjs --apply
-- AlterTable
ALTER TABLE `Execution` ADD COLUMN `refusalReason` VARCHAR(191) NULL;
