-- Research-only persistence; no Bot or Execution modification.
CREATE TABLE `ResearchPartner` (
  `id` VARCHAR(191) NOT NULL, `userId` VARCHAR(191) NOT NULL,
  `name` VARCHAR(120) NOT NULL, `status` VARCHAR(16) NOT NULL DEFAULT 'draft',
  `currentMandateVersion` INTEGER NOT NULL DEFAULT 1,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL, `archivedAt` DATETIME(3) NULL,
  INDEX `ResearchPartner_userId_status_createdAt_idx`(`userId`, `status`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE `ResearchMandateVersion` (
  `id` VARCHAR(191) NOT NULL, `partnerId` VARCHAR(191) NOT NULL,
  `version` INTEGER NOT NULL, `content` JSON NOT NULL,
  `createdBy` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `ResearchMandateVersion_partnerId_createdAt_idx`(`partnerId`, `createdAt`),
  UNIQUE INDEX `ResearchMandateVersion_partnerId_version_key`(`partnerId`, `version`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE `ResearchSession` (
  `id` VARCHAR(191) NOT NULL, `partnerId` VARCHAR(191) NOT NULL,
  `mandateVersion` INTEGER NOT NULL, `question` TEXT NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'queued', `report` JSON NULL,
  `error` VARCHAR(500) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `completedAt` DATETIME(3) NULL,
  INDEX `ResearchSession_partnerId_createdAt_idx`(`partnerId`, `createdAt`),
  INDEX `ResearchSession_status_createdAt_idx`(`status`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE `ResearchMessage` (
  `id` VARCHAR(191) NOT NULL, `sessionId` VARCHAR(191) NOT NULL,
  `role` VARCHAR(16) NOT NULL, `content` TEXT NOT NULL,
  `sources` JSON NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `ResearchMessage_sessionId_createdAt_idx`(`sessionId`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `ResearchMandateVersion` ADD CONSTRAINT `ResearchMandateVersion_partnerId_fkey` FOREIGN KEY (`partnerId`) REFERENCES `ResearchPartner`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `ResearchSession` ADD CONSTRAINT `ResearchSession_partnerId_fkey` FOREIGN KEY (`partnerId`) REFERENCES `ResearchPartner`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `ResearchMessage` ADD CONSTRAINT `ResearchMessage_sessionId_fkey` FOREIGN KEY (`sessionId`) REFERENCES `ResearchSession`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
