CREATE TABLE `ResearchPaperActivation` (
`id` VARCHAR(191) NOT NULL,
`strategyId` VARCHAR(191) NOT NULL,
`version` INTEGER NOT NULL,
`status` VARCHAR(16) NOT NULL DEFAULT 'active',
`revision` INTEGER NOT NULL DEFAULT 0,
`lastSession` VARCHAR(10) NULL,
`state` JSON NOT NULL,
`createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
`updatedAt` DATETIME(3) NOT NULL,
UNIQUE INDEX `ResearchPaperActivation_strategyId_key`(`strategyId`),
PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE `ResearchPaperCycle` (
`id` VARCHAR(191) NOT NULL,
`activationId` VARCHAR(191) NOT NULL,
`session` VARCHAR(10) NOT NULL,
`result` JSON NOT NULL,
`createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
UNIQUE INDEX `ResearchPaperCycle_activationId_session_key`(`activationId`,`session`),
PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `ResearchPaperActivation` ADD CONSTRAINT `ResearchPaperActivation_strategyId_fkey` FOREIGN KEY (`strategyId`) REFERENCES `ResearchPaperStrategy`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `ResearchPaperCycle` ADD CONSTRAINT `ResearchPaperCycle_activationId_fkey` FOREIGN KEY (`activationId`) REFERENCES `ResearchPaperActivation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
