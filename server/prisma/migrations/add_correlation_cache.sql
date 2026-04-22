-- Add correlation cache table for performance optimization
CREATE TABLE CorrelationCache (
  id VARCHAR(255) PRIMARY KEY,
  ticker1 VARCHAR(50) NOT NULL,
  ticker2 VARCHAR(50) NOT NULL,
  correlation DECIMAL(10, 6) NOT NULL,
  calculatedAt DATETIME NOT NULL,
  dataPoints INT NOT NULL,
  periodDays INT DEFAULT 30,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME ON UPDATE CURRENT_TIMESTAMP,
  
  UNIQUE KEY unique_correlation (ticker1, ticker2, periodDays),
  INDEX idx_ticker1 (ticker1),
  INDEX idx_ticker2 (ticker2),
  INDEX idx_calculated_at (calculatedAt),
  INDEX idx_period_days (periodDays)
);

-- Add sector exposure limits table
CREATE TABLE SectorExposureLimit (
  id VARCHAR(255) PRIMARY KEY,
  portfolioId VARCHAR(255) NOT NULL,
  sector VARCHAR(100) NOT NULL,
  maxExposurePercent DECIMAL(5, 2) NOT NULL,
  currentExposurePercent DECIMAL(5, 2) DEFAULT 0,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME ON UPDATE CURRENT_TIMESTAMP,
  
  UNIQUE KEY unique_portfolio_sector (portfolioId, sector),
  INDEX idx_portfolio_id (portfolioId),
  INDEX idx_sector (sector)
);

-- Add ticker concentration limits table
CREATE TABLE TickerConcentrationLimit (
  id VARCHAR(255) PRIMARY KEY,
  portfolioId VARCHAR(255) NOT NULL,
  ticker VARCHAR(50) NOT NULL,
  maxExposurePercent DECIMAL(5, 2) NOT NULL,
  currentExposurePercent DECIMAL(5, 2) DEFAULT 0,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME ON UPDATE CURRENT_TIMESTAMP,
  
  UNIQUE KEY unique_portfolio_ticker (portfolioId, ticker),
  INDEX idx_portfolio_id (portfolioId),
  INDEX idx_ticker (ticker)
);
