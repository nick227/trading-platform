CREATE TABLE `ResearchMandateDialogue` (
  `id` VARCHAR(191) NOT NULL,
  `partnerId` VARCHAR(191) NOT NULL,
  `baseVersion` INTEGER NOT NULL,
  `revision` INTEGER NOT NULL DEFAULT 0,
  `status` VARCHAR(24) NOT NULL DEFAULT 'draft',
  `transcript` JSON NOT NULL,
  `proposal` JSON NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  INDEX `ResearchMandateDialogue_partnerId_updatedAt_idx`(`partnerId`, `updatedAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `ResearchMandateDialogue` ADD CONSTRAINT `ResearchMandateDialogue_partnerId_fkey`
  FOREIGN KEY (`partnerId`) REFERENCES `ResearchPartner`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
