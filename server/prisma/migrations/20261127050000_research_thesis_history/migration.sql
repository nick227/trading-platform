CREATE TABLE `ResearchThesis` (
  `id` VARCHAR(191) NOT NULL, `partnerId` VARCHAR(191) NOT NULL,
  `statement` VARCHAR(600) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `ResearchThesis_partnerId_createdAt_idx`(`partnerId`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE `ResearchThesisAssessment` (
  `id` VARCHAR(191) NOT NULL, `thesisId` VARCHAR(191) NOT NULL, `sessionId` VARCHAR(191) NOT NULL,
  `claim` VARCHAR(500) NOT NULL, `assessment` VARCHAR(24) NOT NULL, `evidenceIds` JSON NOT NULL,
  `recordedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `ResearchThesisAssessment_thesisId_sessionId_key`(`thesisId`, `sessionId`),
  INDEX `ResearchThesisAssessment_sessionId_idx`(`sessionId`),
  INDEX `ResearchThesisAssessment_thesisId_recordedAt_idx`(`thesisId`, `recordedAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `ResearchThesis` ADD CONSTRAINT `ResearchThesis_partnerId_fkey`
 FOREIGN KEY (`partnerId`) REFERENCES `ResearchPartner`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `ResearchThesisAssessment` ADD CONSTRAINT `ResearchThesisAssessment_thesisId_fkey`
 FOREIGN KEY (`thesisId`) REFERENCES `ResearchThesis`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `ResearchThesisAssessment` ADD CONSTRAINT `ResearchThesisAssessment_sessionId_fkey`
 FOREIGN KEY (`sessionId`) REFERENCES `ResearchSession`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
