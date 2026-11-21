-- M6 paper-runtime hardening. Additive only: one nullable column, two appended enum values.
-- Applied on Railway by the API pre-deploy `prisma db push --skip-generate` (no --accept-data-loss).
-- AlterTable
ALTER TABLE `Execution` ADD COLUMN `submitAttemptedAt` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `ExecutionAudit` MODIFY `eventType` ENUM('execution_created', 'claimed', 'submit_attempted', 'submit_confirmed', 'cancel_requested', 'reconciled', 'partial_fill', 'filled', 'cancelled', 'retry_scheduled', 'failed', 'risk_blocked', 'reconcile_required', 'lease_lost') NOT NULL;
