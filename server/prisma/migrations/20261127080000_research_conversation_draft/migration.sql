CREATE TABLE `ResearchConversationDraft` (
  `id` VARCHAR(191) NOT NULL,
  `partnerId` VARCHAR(191) NOT NULL,
  `sessionId` VARCHAR(191) NULL,
  `mandateVersion` INTEGER NOT NULL,
  `revision` INTEGER NOT NULL DEFAULT 1,
  `requestText` TEXT NOT NULL,
  `answerText` TEXT NULL,
  `proposal` JSON NOT NULL,
  `status` VARCHAR(24) NOT NULL DEFAULT 'pending',
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `ResearchConversationDraft_partnerId_updatedAt_idx`(`partnerId`, `updatedAt`),
  INDEX `ResearchConversationDraft_partnerId_status_updatedAt_idx`(`partnerId`, `status`, `updatedAt`),
  CONSTRAINT `ResearchConversationDraft_partnerId_fkey`
    FOREIGN KEY (`partnerId`) REFERENCES `ResearchPartner`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
