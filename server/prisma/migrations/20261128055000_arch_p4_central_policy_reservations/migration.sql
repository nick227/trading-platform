-- CreateTable: TradeIntentRecord (additive — safe for prisma db push --skip-generate)
CREATE TABLE `TradeIntentRecord` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `portfolioId` VARCHAR(191) NOT NULL,
  `botId` VARCHAR(191) NULL,
  `proposalId` VARCHAR(191) NULL,
  `symbol` VARCHAR(24) NOT NULL,
  `side` VARCHAR(8) NOT NULL,
  `quantityMicros` BIGINT NOT NULL,
  `referencePriceMicros` BIGINT NOT NULL,
  `notionalMicros` BIGINT NOT NULL,
  `executionTiming` VARCHAR(24) NOT NULL,
  `authorization` JSON NOT NULL,
  `marketObservation` JSON NOT NULL,
  `policyDecision` JSON NOT NULL,
  `status` VARCHAR(24) NOT NULL,
  `rejectionReason` VARCHAR(191) NULL,
  `executionId` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `TradeIntentRecord_executionId_key`(`executionId`),
  INDEX `TradeIntentRecord_portfolioId_createdAt_idx`(`portfolioId`, `createdAt`),
  INDEX `TradeIntentRecord_userId_createdAt_idx`(`userId`, `createdAt`),
  INDEX `TradeIntentRecord_status_createdAt_idx`(`status`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: PortfolioCapitalReservation
CREATE TABLE `PortfolioCapitalReservation` (
  `id` VARCHAR(191) NOT NULL,
  `portfolioId` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `intentId` VARCHAR(191) NOT NULL,
  `executionId` VARCHAR(191) NULL,
  `ownerType` VARCHAR(32) NOT NULL,
  `ownerId` VARCHAR(191) NOT NULL,
  `side` VARCHAR(8) NOT NULL,
  `symbol` VARCHAR(24) NOT NULL,
  `reservedCashMicros` BIGINT NOT NULL DEFAULT 0,
  `reservedQtyMicros` BIGINT NOT NULL DEFAULT 0,
  `status` VARCHAR(24) NOT NULL DEFAULT 'active',
  `releasedReason` VARCHAR(128) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `PortfolioCapitalReservation_intentId_key`(`intentId`),
  UNIQUE INDEX `PortfolioCapitalReservation_executionId_key`(`executionId`),
  INDEX `PortfolioCapitalReservation_portfolioId_status_idx`(`portfolioId`, `status`),
  INDEX `PortfolioCapitalReservation_portfolioId_symbol_status_idx`(`portfolioId`, `symbol`, `status`),
  INDEX `PortfolioCapitalReservation_userId_status_idx`(`userId`, `status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
