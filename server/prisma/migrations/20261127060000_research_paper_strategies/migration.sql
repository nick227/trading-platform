CREATE TABLE `ResearchPaperStrategy` (
  `id` VARCHAR(191) NOT NULL, `partnerId` VARCHAR(191) NOT NULL,
  `name` VARCHAR(120) NOT NULL, `status` VARCHAR(32) NOT NULL DEFAULT 'draft',
  `currentVersion` INTEGER NOT NULL DEFAULT 1,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  INDEX `ResearchPaperStrategy_partnerId_createdAt_idx` (`partnerId`,`createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE `ResearchPaperStrategyVersion` (
  `id` VARCHAR(191) NOT NULL, `strategyId` VARCHAR(191) NOT NULL, `version` INTEGER NOT NULL,
  `definition` JSON NOT NULL, `provenance` JSON NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `ResearchPaperStrategyVersion_strategyId_version_key` (`strategyId`,`version`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `ResearchPaperStrategy` ADD CONSTRAINT `ResearchPaperStrategy_partnerId_fkey` FOREIGN KEY (`partnerId`) REFERENCES `ResearchPartner`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `ResearchPaperStrategyVersion` ADD CONSTRAINT `ResearchPaperStrategyVersion_strategyId_fkey` FOREIGN KEY (`strategyId`) REFERENCES `ResearchPaperStrategy`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
