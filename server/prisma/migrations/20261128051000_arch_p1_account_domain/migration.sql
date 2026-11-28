-- AlterTable (additive only — safe for prisma db push --skip-generate)
ALTER TABLE `Portfolio`
  ADD COLUMN `environment` VARCHAR(32) NOT NULL DEFAULT 'internal_sim',
  ADD COLUMN `brokerConnectionId` VARCHAR(191) NULL,
  ADD COLUMN `status` VARCHAR(32) NOT NULL DEFAULT 'active';

CREATE INDEX `Portfolio_userId_environment_idx` ON `Portfolio`(`userId`, `environment`);
CREATE INDEX `Portfolio_brokerConnectionId_idx` ON `Portfolio`(`brokerConnectionId`);

-- CreateTable
CREATE TABLE `BrokerConnection` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `provider` VARCHAR(32) NOT NULL DEFAULT 'alpaca',
  `environment` VARCHAR(32) NOT NULL DEFAULT 'alpaca_paper',
  `externalAccountId` VARCHAR(128) NOT NULL,
  `encryptedApiKey` TEXT NOT NULL,
  `encryptedApiSecret` TEXT NOT NULL,
  `keyVersion` INTEGER NOT NULL DEFAULT 1,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `lastVerifiedAt` DATETIME(3) NULL,
  `disconnectedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `BrokerConnection_userId_provider_environment_externalAccountId_key`(`userId`, `provider`, `environment`, `externalAccountId`),
  INDEX `BrokerConnection_userId_status_idx`(`userId`, `status`),
  INDEX `BrokerConnection_userId_environment_idx`(`userId`, `environment`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
