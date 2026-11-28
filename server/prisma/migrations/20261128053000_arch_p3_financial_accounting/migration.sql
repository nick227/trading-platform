-- CreateTable: PortfolioCashEntry (additive — safe for prisma db push --skip-generate)
CREATE TABLE `PortfolioCashEntry` (
  `id` VARCHAR(191) NOT NULL,
  `portfolioId` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `entryType` VARCHAR(32) NOT NULL,
  `amountMicros` BIGINT NOT NULL,
  `amountDecimal` DECIMAL(16, 4) NOT NULL,
  `executionId` VARCHAR(191) NULL,
  `externalActivityId` VARCHAR(191) NULL,
  `effectiveAt` DATETIME(3) NOT NULL,
  `metadata` JSON NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `PortfolioCashEntry_externalActivityId_key`(`externalActivityId`),
  INDEX `PortfolioCashEntry_portfolioId_effectiveAt_idx`(`portfolioId`, `effectiveAt`),
  INDEX `PortfolioCashEntry_userId_effectiveAt_idx`(`userId`, `effectiveAt`),
  INDEX `PortfolioCashEntry_executionId_idx`(`executionId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: PositionLot
CREATE TABLE `PositionLot` (
  `id` VARCHAR(191) NOT NULL,
  `portfolioId` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `symbol` VARCHAR(24) NOT NULL,
  `ownerType` VARCHAR(32) NOT NULL,
  `ownerId` VARCHAR(191) NOT NULL,
  `openExecutionId` VARCHAR(191) NULL,
  `externalPositionKey` VARCHAR(191) NULL,
  `openedAt` DATETIME(3) NOT NULL,
  `initialQtyMicros` BIGINT NOT NULL,
  `remainingQtyMicros` BIGINT NOT NULL,
  `unitCostMicros` BIGINT NOT NULL,
  `feesMicros` BIGINT NOT NULL DEFAULT 0,
  `status` VARCHAR(16) NOT NULL DEFAULT 'open',
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `PositionLot_openExecutionId_key`(`openExecutionId`),
  UNIQUE INDEX `PositionLot_externalPositionKey_key`(`externalPositionKey`),
  INDEX `PositionLot_portfolioId_symbol_status_idx`(`portfolioId`, `symbol`, `status`),
  INDEX `PositionLot_portfolioId_ownerType_ownerId_status_idx`(`portfolioId`, `ownerType`, `ownerId`, `status`),
  INDEX `PositionLot_userId_status_idx`(`userId`, `status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: PortfolioDailySnapshot
CREATE TABLE `PortfolioDailySnapshot` (
  `id` VARCHAR(191) NOT NULL,
  `portfolioId` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `sessionDate` VARCHAR(10) NOT NULL,
  `cashDecimal` DECIMAL(16, 2) NOT NULL,
  `marketValueDecimal` DECIMAL(16, 2) NOT NULL,
  `equityDecimal` DECIMAL(16, 2) NOT NULL,
  `netExternalCashFlowDecimal` DECIMAL(16, 2) NOT NULL DEFAULT 0,
  `realizedPnlDecimal` DECIMAL(16, 2) NOT NULL DEFAULT 0,
  `unrealizedPnlDecimal` DECIMAL(16, 2) NOT NULL DEFAULT 0,
  `priceProvenance` JSON NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `PortfolioDailySnapshot_portfolioId_sessionDate_key`(`portfolioId`, `sessionDate`),
  INDEX `PortfolioDailySnapshot_userId_sessionDate_idx`(`userId`, `sessionDate`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
