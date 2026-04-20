-- MVP Schema for Single User Operator Mode
-- Essential tables for paper trading and bot performance tracking

-- Single operator user
CREATE TABLE IF NOT EXISTS users (
  id INT PRIMARY KEY AUTO_INCREMENT,
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  role ENUM('operator', 'admin') DEFAULT 'operator',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_email (email)
);

-- Broker credentials (encrypted)
CREATE TABLE IF NOT EXISTS broker_accounts (
  id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,
  provider ENUM('alpaca') DEFAULT 'alpaca',
  paper BOOLEAN DEFAULT TRUE,
  api_key_encrypted TEXT NOT NULL,
  api_secret_encrypted TEXT NOT NULL,
  status ENUM('active', 'error', 'disabled') DEFAULT 'active',
  last_verified_at TIMESTAMP NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_user_id (user_id),
  INDEX idx_status (status)
);

-- Bot execution runs
CREATE TABLE IF NOT EXISTS bot_runs (
  id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,
  started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  ended_at TIMESTAMP NULL,
  status ENUM('running', 'completed', 'failed') DEFAULT 'running',
  signal_count INT DEFAULT 0,
  execution_count INT DEFAULT 0,
  total_pnl DECIMAL(10,2) DEFAULT 0,
  notes TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_user_id (user_id),
  INDEX idx_status (status),
  INDEX idx_started_at (started_at)
);

-- Individual trade executions
CREATE TABLE IF NOT EXISTS executions (
  id INT PRIMARY KEY AUTO_INCREMENT,
  bot_run_id INT NULL,
  user_id INT NOT NULL,
  symbol VARCHAR(10) NOT NULL,
  side ENUM('buy', 'sell') NOT NULL,
  quantity DECIMAL(10,4) NOT NULL,
  signal_score DECIMAL(3,2),
  alpaca_order_id VARCHAR(50),
  status ENUM('submitted', 'filled', 'cancelled', 'failed') DEFAULT 'submitted',
  fill_price DECIMAL(10,4),
  commission DECIMAL(8,2) DEFAULT 0,
  pnl DECIMAL(10,2) DEFAULT 0,
  submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  filled_at TIMESTAMP NULL,
  FOREIGN KEY (bot_run_id) REFERENCES bot_runs(id) ON DELETE SET NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_bot_run_id (bot_run_id),
  INDEX idx_user_id (user_id),
  INDEX idx_symbol (symbol),
  INDEX idx_status (status),
  INDEX idx_submitted_at (submitted_at)
);

-- Daily performance snapshots
CREATE TABLE IF NOT EXISTS daily_snapshots (
  id INT PRIMARY KEY AUTO_INCREMENT,
  snapshot_date DATE UNIQUE NOT NULL,
  equity DECIMAL(12,2) NOT NULL,
  cash DECIMAL(12,2) NOT NULL,
  positions_value DECIMAL(12,2) NOT NULL,
  day_pnl DECIMAL(10,2) DEFAULT 0,
  total_trades INT DEFAULT 0,
  winning_trades INT DEFAULT 0,
  captured_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_snapshot_date (snapshot_date)
);

-- Insert default operator user
INSERT IGNORE INTO users (id, email, name, role) VALUES (1, 'operator@localhost', 'Operator', 'operator');
