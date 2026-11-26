-- Flagship AI usage budgets and reservations (MySQL)
CREATE TABLE `AiUsageBucket` (
  `id` VARCHAR(191) NOT NULL,
  `period` VARCHAR(7) NOT NULL,
  `budgetCents` INTEGER NOT NULL,
  `reservedCents` INTEGER NOT NULL DEFAULT 0,
  `spentCents` INTEGER NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  INDEX `AiUsageBucket_period_idx`(`period`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `AiUsageCall` (
  `id` VARCHAR(191) NOT NULL,
  `botId` VARCHAR(191) NOT NULL,
  `period` VARCHAR(7) NOT NULL,
  `jobKey` VARCHAR(191) NOT NULL,
  `model` VARCHAR(80) NOT NULL,
  `status` VARCHAR(30) NOT NULL,
  `reservedCents` INTEGER NOT NULL,
  `actualCents` INTEGER NULL,
  `promptTokens` INTEGER NULL,
  `outputTokens` INTEGER NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `completedAt` DATETIME(3) NULL,
  INDEX `AiUsageCall_botId_period_idx`(`botId`, `period`),
  INDEX `AiUsageCall_status_createdAt_idx`(`status`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
