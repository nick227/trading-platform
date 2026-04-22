-- Add execution reservations table for atomic risk management
CREATE TABLE ExecutionReservation (
  id VARCHAR(255) PRIMARY KEY,
  portfolioId VARCHAR(255) NOT NULL,
  status VARCHAR(50) DEFAULT 'active',
  expiresAt DATETIME NOT NULL,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  releasedAt DATETIME NULL,
  
  INDEX idx_portfolio_status (portfolioId, status),
  INDEX idx_expires (expiresAt),
  INDEX idx_status (status)
);

-- Add equity peaks table for proper drawdown calculation
CREATE TABLE EquityPeak (
  portfolioId VARCHAR(255) PRIMARY KEY,
  peakEquity DECIMAL(12,2) NOT NULL,
  peakDate DATETIME NOT NULL,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME ON UPDATE CURRENT_TIMESTAMP,
  
  INDEX idx_peak_date (peakDate),
  INDEX idx_updated_at (updatedAt)
);

-- Add risk settings to User model if not already present
ALTER TABLE User ADD COLUMN IF NOT EXISTS riskSettings JSON;

-- Add cash and totalValue fields to Portfolio model for better risk tracking
ALTER TABLE Portfolio ADD COLUMN IF NOT EXISTS cashBalance DECIMAL(12,2) DEFAULT 0;
ALTER TABLE Portfolio ADD COLUMN IF NOT EXISTS totalValue DECIMAL(12,2) DEFAULT 0;
ALTER TABLE Portfolio ADD COLUMN IF NOT EXISTS updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;

-- Add indexes for better performance
CREATE INDEX IF NOT EXISTS idx_portfolio_updated ON Portfolio(updatedAt);
CREATE INDEX IF NOT EXISTS idx_portfolio_value ON Portfolio(totalValue);
