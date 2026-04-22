-- Create on 2026-04-22 02:00:00.000000
-- Performance optimization indexes for trading platform

-- Composite indexes for frequently queried combinations
-- These address the most common query patterns identified in the codebase

-- 1. Bot queries with user filtering and status
CREATE INDEX CONCURRENTLY idx_bots_user_enabled_deleted ON bots(user_id, enabled, deleted_at) WHERE deleted_at IS NULL;

-- 2. Bot queries with portfolio and type filtering
CREATE INDEX CONCURRENTLY idx_bots_portfolio_type_enabled ON bots(portfolio_id, bot_type, enabled) WHERE deleted_at IS NULL;

-- 3. Execution queries for portfolio performance (most critical)
CREATE INDEX CONCURRENTLY idx_executions_portfolio_status_time ON executions(portfolio_id, status, created_at);
CREATE INDEX CONCURRENTLY idx_executions_portfolio_filled_time ON executions(portfolio_id, filled_at) WHERE filled_at IS NOT NULL;

-- 4. Execution queries for ticker-specific analysis
CREATE INDEX CONCURRENTLY idx_executions_ticker_status_time ON executions(ticker, status, created_at);

-- 5. Bot events for activity feeds (N+1 query fix)
CREATE INDEX CONCURRENTLY idx_bot_events_bot_created_type ON bot_events(bot_id, created_at, type);
CREATE INDEX CONCURRENTLY idx_bot_events_portfolio_created_type ON bot_events(portfolio_id, created_at, type);

-- 6. Strategy-based bot queries
CREATE INDEX CONCURRENTLY idx_bots_strategy_enabled ON bots(strategy_id, enabled) WHERE strategy_id IS NOT NULL;

-- 7. Template usage tracking
CREATE INDEX CONCURRENTLY idx_bots_template_created ON bots(template_id, created_at) WHERE template_id IS NOT NULL;

-- 8. Worker queue optimization
CREATE INDEX CONCURRENTLY idx_executions_status_locked_worker ON executions(status, locked_at, locked_by) WHERE status IN ('queued', 'processing');

-- 9. Daily loss rule optimization (critical for risk management)
CREATE INDEX CONCURRENTLY idx_executions_portfolio_filled_daily ON executions(portfolio_id, filled_at, pnl) 
WHERE filled_at IS NOT NULL AND status = 'filled';

-- 10. User portfolio summary queries
CREATE INDEX CONCURRENTLY idx_executions_user_portfolio_time ON executions(user_id, portfolio_id, created_at);

-- Partial indexes for better performance on filtered queries
CREATE INDEX CONCURRENTLY idx_bots_active ON bots(enabled, created_at) WHERE enabled = true AND deleted_at IS NULL;
CREATE INDEX CONCURRENTLY idx_executions_filled ON executions(filled_at, portfolio_id) WHERE filled_at IS NOT NULL;
CREATE INDEX CONCURRENTLY idx_executions_queued ON executions(status, scheduled_for) WHERE status = 'queued';

-- Covering indexes to eliminate table lookups
CREATE INDEX CONCURRENTLY idx_bots_covering_active ON bots(user_id, portfolio_id, enabled, name, bot_type, created_at) 
WHERE enabled = true AND deleted_at IS NULL;

-- Statistics update for better query planning
ANALYZE bots;
ANALYZE executions;
ANALYZE bot_events;
ANALYZE bot_templates;
ANALYZE bot_rules;
