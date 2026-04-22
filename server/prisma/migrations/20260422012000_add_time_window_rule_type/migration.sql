-- AlterTable
ALTER TABLE `BotRule` MODIFY `type` ENUM('price_threshold', 'position_limit', 'daily_loss', 'market_hours', 'cooldown', 'trend_filter', 'time_window') NOT NULL;

