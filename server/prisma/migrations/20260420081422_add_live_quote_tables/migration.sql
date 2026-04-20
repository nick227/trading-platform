-- CreateTable
CREATE TABLE `Strategy` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Strategy_type_idx`(`type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Prediction` (
    `id` VARCHAR(191) NOT NULL,
    `strategyId` VARCHAR(191) NOT NULL,
    `ticker` VARCHAR(191) NOT NULL,
    `direction` ENUM('buy', 'sell') NOT NULL,
    `confidence` DOUBLE NOT NULL,
    `entryPrice` DOUBLE NOT NULL,
    `stopPrice` DOUBLE NOT NULL,
    `targetPrice` DOUBLE NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `regime` VARCHAR(191) NOT NULL,
    `reasoning` VARCHAR(191) NOT NULL,

    INDEX `Prediction_ticker_createdAt_idx`(`ticker`, `createdAt`),
    INDEX `Prediction_strategyId_idx`(`strategyId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Portfolio` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Portfolio_createdAt_idx`(`createdAt`),
    INDEX `Portfolio_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BotTemplate` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NOT NULL,
    `botType` VARCHAR(191) NOT NULL,
    `config` JSON NOT NULL,
    `rules` JSON NOT NULL,
    `tags` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `BotTemplate_botType_idx`(`botType`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Bot` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `portfolioId` VARCHAR(191) NOT NULL,
    `strategyId` VARCHAR(191) NULL,
    `templateId` VARCHAR(191) NULL,
    `botType` VARCHAR(191) NOT NULL DEFAULT 'rule_based',
    `name` VARCHAR(191) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `config` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    INDEX `Bot_portfolioId_idx`(`portfolioId`),
    INDEX `Bot_enabled_idx`(`enabled`),
    INDEX `Bot_userId_idx`(`userId`),
    INDEX `Bot_templateId_idx`(`templateId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BotRule` (
    `id` VARCHAR(191) NOT NULL,
    `botId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `type` ENUM('price_threshold', 'position_limit', 'daily_loss', 'market_hours', 'cooldown') NOT NULL,
    `config` JSON NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `BotRule_botId_enabled_idx`(`botId`, `enabled`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BotEvent` (
    `id` VARCHAR(191) NOT NULL,
    `botId` VARCHAR(191) NOT NULL,
    `portfolioId` VARCHAR(191) NOT NULL,
    `ruleId` VARCHAR(191) NULL,
    `executionId` VARCHAR(191) NULL,
    `type` ENUM('rule_triggered', 'decision_made', 'execution_created', 'execution_skipped', 'error_occurred') NOT NULL,
    `detail` VARCHAR(191) NOT NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `BotEvent_botId_createdAt_idx`(`botId`, `createdAt`),
    INDEX `BotEvent_portfolioId_createdAt_idx`(`portfolioId`, `createdAt`),
    INDEX `BotEvent_executionId_idx`(`executionId`),
    INDEX `BotEvent_type_idx`(`type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Execution` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `portfolioId` VARCHAR(191) NOT NULL,
    `strategyId` VARCHAR(191) NULL,
    `predictionId` VARCHAR(191) NULL,
    `botId` VARCHAR(191) NULL,
    `botRunId` INTEGER NULL,
    `ticker` VARCHAR(191) NOT NULL,
    `direction` ENUM('buy', 'sell') NOT NULL,
    `quantity` DOUBLE NOT NULL,
    `price` DOUBLE NOT NULL,
    `origin` VARCHAR(191) NOT NULL DEFAULT 'manual',
    `status` VARCHAR(191) NOT NULL DEFAULT 'queued',
    `lockedAt` DATETIME(3) NULL,
    `lockedBy` VARCHAR(191) NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `clientOrderId` VARCHAR(191) NULL,
    `activeIntentKey` VARCHAR(191) NULL,
    `brokerOrderId` VARCHAR(191) NULL,
    `brokerStatus` VARCHAR(191) NULL,
    `submittedAt` DATETIME(3) NULL,
    `lastBrokerSyncAt` DATETIME(3) NULL,
    `filledAt` DATETIME(3) NULL,
    `filledPrice` DOUBLE NULL,
    `filledQuantity` DOUBLE NULL,
    `cancelReason` VARCHAR(191) NULL,
    `cancelRequestedAt` DATETIME(3) NULL,
    `cancelRequestedBy` VARCHAR(191) NULL,
    `cancelRequestReason` VARCHAR(191) NULL,
    `commission` DOUBLE NOT NULL,
    `fees` DOUBLE NOT NULL,
    `signalScore` DECIMAL(3, 2) NULL,
    `pnl` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Execution_clientOrderId_key`(`clientOrderId`),
    UNIQUE INDEX `Execution_activeIntentKey_key`(`activeIntentKey`),
    INDEX `Execution_portfolioId_createdAt_idx`(`portfolioId`, `createdAt`),
    INDEX `Execution_ticker_createdAt_idx`(`ticker`, `createdAt`),
    INDEX `Execution_strategyId_idx`(`strategyId`),
    INDEX `Execution_botId_createdAt_idx`(`botId`, `createdAt`),
    INDEX `Execution_status_lockedAt_idx`(`status`, `lockedAt`),
    INDEX `Execution_botId_ticker_status_idx`(`botId`, `ticker`, `status`),
    INDEX `Execution_status_filledAt_idx`(`status`, `filledAt`),
    INDEX `Execution_createdAt_id_idx`(`createdAt`, `id`),
    INDEX `Execution_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ExecutionAudit` (
    `id` VARCHAR(191) NOT NULL,
    `executionId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `workerId` VARCHAR(191) NULL,
    `eventType` ENUM('execution_created', 'claimed', 'submit_attempted', 'submit_confirmed', 'cancel_requested', 'reconciled', 'partial_fill', 'filled', 'cancelled', 'retry_scheduled', 'failed', 'risk_blocked') NOT NULL,
    `detail` VARCHAR(191) NOT NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ExecutionAudit_executionId_createdAt_idx`(`executionId`, `createdAt`),
    INDEX `ExecutionAudit_eventType_createdAt_idx`(`eventType`, `createdAt`),
    INDEX `ExecutionAudit_userId_createdAt_idx`(`userId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BrokerAccount` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `broker` VARCHAR(191) NOT NULL DEFAULT 'alpaca',
    `apiKey` VARCHAR(191) NOT NULL,
    `apiSecret` VARCHAR(191) NOT NULL,
    `paper` BOOLEAN NOT NULL DEFAULT true,
    `status` VARCHAR(191) NOT NULL DEFAULT 'active',
    `lastVerifiedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `BrokerAccount_userId_key`(`userId`),
    INDEX `BrokerAccount_userId_idx`(`userId`),
    INDEX `BrokerAccount_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `User` (
    `id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `passwordHash` VARCHAR(191) NOT NULL,
    `fullName` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `User_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Subscription` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE',
    `plan` VARCHAR(191) NOT NULL DEFAULT 'BASIC',
    `endsAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Subscription_userId_key`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WorkerStatus` (
    `id` VARCHAR(191) NOT NULL,
    `lastSeen` DATETIME(3) NOT NULL,
    `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `queueLagMs` INTEGER NULL,
    `lastRestOkAt` DATETIME(3) NULL,
    `lastWsOkAt` DATETIME(3) NULL,
    `lastCalendarRefreshAt` DATETIME(3) NULL,
    `health` JSON NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BotRun` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` VARCHAR(191) NOT NULL,
    `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `endedAt` DATETIME(3) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'running',
    `signalCount` INTEGER NOT NULL DEFAULT 0,
    `executionCount` INTEGER NOT NULL DEFAULT 0,
    `totalPnl` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `notes` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `BotRun_userId_idx`(`userId`),
    INDEX `BotRun_status_idx`(`status`),
    INDEX `BotRun_startedAt_idx`(`startedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DailySnapshot` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `snapshotDate` DATE NOT NULL,
    `equity` DECIMAL(12, 2) NOT NULL,
    `cash` DECIMAL(12, 2) NOT NULL,
    `positionsValue` DECIMAL(12, 2) NOT NULL,
    `dayPnl` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `totalTrades` INTEGER NOT NULL DEFAULT 0,
    `winningTrades` INTEGER NOT NULL DEFAULT 0,
    `capturedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `DailySnapshot_snapshotDate_key`(`snapshotDate`),
    INDEX `DailySnapshot_snapshotDate_idx`(`snapshotDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LiveQuote` (
    `ticker` VARCHAR(191) NOT NULL,
    `bid` DOUBLE NULL,
    `ask` DOUBLE NULL,
    `last` DOUBLE NOT NULL,
    `changePct` DOUBLE NOT NULL DEFAULT 0,
    `volume` INTEGER NOT NULL DEFAULT 0,
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `LiveQuote_updatedAt_idx`(`updatedAt`),
    PRIMARY KEY (`ticker`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LiveQuoteSubscription` (
    `ticker` VARCHAR(191) NOT NULL,
    `requestedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `LiveQuoteSubscription_requestedAt_idx`(`requestedAt`),
    PRIMARY KEY (`ticker`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Prediction` ADD CONSTRAINT `Prediction_strategyId_fkey` FOREIGN KEY (`strategyId`) REFERENCES `Strategy`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Bot` ADD CONSTRAINT `Bot_portfolioId_fkey` FOREIGN KEY (`portfolioId`) REFERENCES `Portfolio`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Bot` ADD CONSTRAINT `Bot_strategyId_fkey` FOREIGN KEY (`strategyId`) REFERENCES `Strategy`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Bot` ADD CONSTRAINT `Bot_templateId_fkey` FOREIGN KEY (`templateId`) REFERENCES `BotTemplate`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BotRule` ADD CONSTRAINT `BotRule_botId_fkey` FOREIGN KEY (`botId`) REFERENCES `Bot`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BotEvent` ADD CONSTRAINT `BotEvent_botId_fkey` FOREIGN KEY (`botId`) REFERENCES `Bot`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BotEvent` ADD CONSTRAINT `BotEvent_executionId_fkey` FOREIGN KEY (`executionId`) REFERENCES `Execution`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Execution` ADD CONSTRAINT `Execution_portfolioId_fkey` FOREIGN KEY (`portfolioId`) REFERENCES `Portfolio`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Execution` ADD CONSTRAINT `Execution_strategyId_fkey` FOREIGN KEY (`strategyId`) REFERENCES `Strategy`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Execution` ADD CONSTRAINT `Execution_predictionId_fkey` FOREIGN KEY (`predictionId`) REFERENCES `Prediction`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Execution` ADD CONSTRAINT `Execution_botId_fkey` FOREIGN KEY (`botId`) REFERENCES `Bot`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Execution` ADD CONSTRAINT `Execution_botRunId_fkey` FOREIGN KEY (`botRunId`) REFERENCES `BotRun`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ExecutionAudit` ADD CONSTRAINT `ExecutionAudit_executionId_fkey` FOREIGN KEY (`executionId`) REFERENCES `Execution`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Subscription` ADD CONSTRAINT `Subscription_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
