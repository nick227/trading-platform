-- Add bot status enum and related fields
CREATE TYPE bot_status_enum AS ENUM (
  'active',
  'paused_user',
  'paused_risk', 
  'paused_admin',
  'cooldown',
  'recovering'
);

-- Add bot status fields to Bot model
ALTER TABLE Bot 
ADD COLUMN status bot_status_enum DEFAULT 'active',
ADD COLUMN statusReason VARCHAR(255),
ADD COLUMN statusChangedAt DATETIME,
ADD COLUMN metadata JSON;

-- Add risk overlay to Portfolio model
ALTER TABLE Portfolio 
ADD COLUMN riskOverlay JSON;

-- Add notification preferences to Portfolio model
ALTER TABLE Portfolio 
ADD COLUMN notificationPreferences JSON DEFAULT '{
  "email": true,
  "sms": false,
  "push": true,
  "inApp": true,
  "levels": {
    "critical": true,
    "high": true,
    "medium": true,
    "low": false
  },
  "quietHours": {
    "enabled": false,
    "start": "22:00",
    "end": "08:00"
  }
}';

-- Create indexes for new fields
CREATE INDEX idx_bot_status ON Bot(status);
CREATE INDEX idx_bot_status_changed_at ON Bot(statusChangedAt);
CREATE INDEX idx_bot_portfolio_status ON Bot(portfolioId, status);
CREATE INDEX idx_portfolio_risk_overlay ON Portfolio(id) WHERE riskOverlay IS NOT NULL;

-- Update existing bots to have status
UPDATE Bot 
SET status = CASE 
  WHEN enabled = true THEN 'active'
  ELSE 'paused_user'
END,
statusReason = 'migration_from_enabled_field',
statusChangedAt = NOW()
WHERE status IS NULL;
