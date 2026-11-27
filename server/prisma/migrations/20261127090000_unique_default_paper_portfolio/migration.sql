-- Enforce database-level uniqueness for each user's default simulated paper portfolio
-- and separate simulated paper portfolios from external brokerage/custom portfolios.
ALTER TABLE `Portfolio`
  ADD COLUMN `accountKind` VARCHAR(32) NOT NULL DEFAULT 'custom',
  ADD COLUMN `defaultPaperUserId` VARCHAR(191) NULL;

CREATE UNIQUE INDEX `Portfolio_defaultPaperUserId_key` ON `Portfolio`(`defaultPaperUserId`);
CREATE INDEX `Portfolio_userId_accountKind_idx` ON `Portfolio`(`userId`, `accountKind`);
