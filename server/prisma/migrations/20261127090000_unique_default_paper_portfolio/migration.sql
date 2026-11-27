-- Additive-only migration compatible with Railway `prisma db push --skip-generate` (no --accept-data-loss).
-- Enforces database-level 1:1 uniqueness for each user's default simulated paper portfolio via
-- DefaultPaperPortfolio (userId PRIMARY KEY + portfolioId UNIQUE) and tags Portfolio.accountKind.
ALTER TABLE `Portfolio`
  ADD COLUMN `accountKind` VARCHAR(32) NOT NULL DEFAULT 'custom';

CREATE INDEX `Portfolio_userId_accountKind_idx` ON `Portfolio`(`userId`, `accountKind`);

CREATE TABLE `DefaultPaperPortfolio` (
  `userId` VARCHAR(191) NOT NULL,
  `portfolioId` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `DefaultPaperPortfolio_portfolioId_key`(`portfolioId`),
  PRIMARY KEY (`userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `DefaultPaperPortfolio`
  ADD CONSTRAINT `DefaultPaperPortfolio_userId_fkey`
  FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `DefaultPaperPortfolio`
  ADD CONSTRAINT `DefaultPaperPortfolio_portfolioId_fkey`
  FOREIGN KEY (`portfolioId`) REFERENCES `Portfolio`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
