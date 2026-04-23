CREATE TABLE `DiscoverySymbol` (
  `symbol` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NULL,
  `marketCap` DOUBLE NULL,
  `avgVolume` DOUBLE NULL,
  `lastPrice` DOUBLE NULL,
  `sector` VARCHAR(191) NULL,
  `industry` VARCHAR(191) NULL,
  `isTradable` BOOLEAN NOT NULL DEFAULT false,
  `tradableBroker` VARCHAR(191) NULL,
  `untradableReason` VARCHAR(191) NULL,
  `source` VARCHAR(191) NOT NULL DEFAULT 'manual',
  `lastProfileRefreshAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`symbol`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX `DiscoverySymbol_lastPrice_idx` ON `DiscoverySymbol`(`lastPrice`);
CREATE INDEX `DiscoverySymbol_isTradable_lastPrice_idx` ON `DiscoverySymbol`(`isTradable`, `lastPrice`);
CREATE INDEX `DiscoverySymbol_marketCap_idx` ON `DiscoverySymbol`(`marketCap`);
CREATE INDEX `DiscoverySymbol_updatedAt_idx` ON `DiscoverySymbol`(`updatedAt`);
