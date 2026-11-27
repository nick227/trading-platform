-- RP-06: immutable research lineage.
ALTER TABLE `ResearchSession` ADD COLUMN `parentSessionId` VARCHAR(191) NULL;
CREATE INDEX `ResearchSession_parentSessionId_idx` ON `ResearchSession`(`parentSessionId`);
