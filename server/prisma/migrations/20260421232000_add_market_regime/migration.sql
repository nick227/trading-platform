-- CreateTable
CREATE TABLE `MarketRegime` (
    `id` VARCHAR(191) NOT NULL,
    `symbol` VARCHAR(191) NOT NULL,
    `asOf` DATETIME(3) NOT NULL,
    `regime` VARCHAR(191) NOT NULL,
    `score` DOUBLE NULL,
    `priceClose` DOUBLE NULL,
    `sma20` DOUBLE NULL,
    `sma200` DOUBLE NULL,
    `inputsJson` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `MarketRegime_symbol_asOf_key`(`symbol`, `asOf`),
    INDEX `MarketRegime_symbol_asOf_idx`(`symbol`, `asOf` DESC),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

