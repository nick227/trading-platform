CREATE TABLE `ResearchPaperBacktest` (
  `id` VARCHAR(191) NOT NULL,
  `strategyId` VARCHAR(191) NOT NULL,
  `version` INTEGER NOT NULL,
  `startSession` VARCHAR(10) NOT NULL,
  `endSession` VARCHAR(10) NOT NULL,
  `result` JSON NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `ResearchPaperBacktest_strategyId_createdAt_idx` (`strategyId`,`createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `ResearchPaperBacktest` ADD CONSTRAINT `ResearchPaperBacktest_strategyId_fkey` FOREIGN KEY (`strategyId`) REFERENCES `ResearchPaperStrategy`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
