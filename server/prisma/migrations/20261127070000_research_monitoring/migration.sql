CREATE TABLE `ResearchMonitor` (
  `id` VARCHAR(191) NOT NULL, `partnerId` VARCHAR(191) NOT NULL,
  `name` VARCHAR(120) NOT NULL, `status` VARCHAR(16) NOT NULL DEFAULT 'active',
  `cadence` VARCHAR(16) NOT NULL DEFAULT 'daily', `symbols` JSON NOT NULL,
  `seenHashes` JSON NOT NULL, `lastFingerprint` VARCHAR(191) NULL,
  `nextCheckAt` DATETIME(3) NOT NULL, `lastCheckedAt` DATETIME(3) NULL,
  `lastError` VARCHAR(500) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  INDEX `ResearchMonitor_partnerId_createdAt_idx` (`partnerId`,`createdAt`),
  INDEX `ResearchMonitor_status_nextCheckAt_idx` (`status`,`nextCheckAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE `ResearchMonitorEvent` (
  `id` VARCHAR(191) NOT NULL, `monitorId` VARCHAR(191) NOT NULL,
  `kind` VARCHAR(32) NOT NULL, `payload` JSON NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `ResearchMonitorEvent_monitorId_createdAt_idx` (`monitorId`,`createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `ResearchMonitor` ADD CONSTRAINT `ResearchMonitor_partnerId_fkey`
  FOREIGN KEY (`partnerId`) REFERENCES `ResearchPartner`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `ResearchMonitorEvent` ADD CONSTRAINT `ResearchMonitorEvent_monitorId_fkey`
  FOREIGN KEY (`monitorId`) REFERENCES `ResearchMonitor`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
