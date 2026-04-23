# Trading Platform Worker

A long-running Node.js process that handles real-time trading operations, bot execution, and market data processing. The worker operates alongside the API server and manages all broker interactions.

## Overview

The worker system is responsible for:
- **Market Data Collection**: Real-time price feeds via Alpaca WebSocket
- **Bot Engine**: Evaluates trading rules and triggers automated orders
- **Order Execution**: Submits trades to broker and tracks fulfillment
- **Risk Management**: Enforces position limits and trading safeguards

## Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   API Server    │    │   Worker        │    │   Alpaca API    │
│                 │    │                 │    │                 │
│ - Creates bots  │◄──►│ - Bot Engine    │◄──►│ - Order submit  │
│ - Queues orders │    │ - Market Data   │    │ - Market data   │
│ - UI interface  │    │ - Order Worker  │    │ - Account info  │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         └───────────────────────┼───────────────────────┘
                                 │
                    ┌─────────────────┐
                    │   Database      │
                    │                 │
                    │ - Bot configs  │
                    │ - Executions   │
                    │ - User accounts │
                    └─────────────────┘
```

## Quick Start

### Prerequisites
- Node.js 18+
- MySQL database
- Alpaca API credentials (stored in database)

### Installation
```bash
cd worker
npm install
npm run db:generate
```

### Running the Worker

The worker needs to be started separately from the server. Here are the recommended startup sequences:

#### Development Mode (Recommended)
From the root directory, start all services:
```bash
# From project root (c:\wamp64\www\trading-platform)
npm run dev:start
```
This starts:
- Frontend app (`npm run dev`)
- API server (`npm run dev:server`) 
- Worker (`npm run dev:worker`)

#### Individual Services
```bash
# Terminal 1: API Server
cd server && npm run dev

# Terminal 2: Worker  
cd worker && npm run dev

# Terminal 3: Frontend (optional)
npm run dev
```

#### Production Mode
```bash
# From project root - starts both server and worker
npm run start

# Or individually
npm run start:server  # Starts API server
npm run start:worker  # Starts worker
```

#### Railway Deployment
The platform is configured to deploy all three services as separate Railway services under the same project:

- **Frontend**: `app/` directory → Runs on `$PORT` with `npm run preview`
- **API Server**: `server/` directory → Runs with `npm start`
- **Worker**: `worker/` directory → Runs with `npm start`

Each service has its own `railway.json` configuration file and will be deployed as separate containers that share the same database and environment variables.

#### Quick Startup Summary
- **Development**: `npm run dev:start` (from root)
- **Production**: `npm run start` (from root)
- **Railway**: Automatic deployment of 3 separate services
- **Current setup**: You're running the correct sequence with separate terminals for server and worker

### Environment Variables
```env
DATABASE_URL=mysql://user:pass@host:3306/db
ALLOW_LIVE_TRADING=false  # Set to true for live trading
```

## Core Components

### 1. Bootstrap (`src/worker.js`)
Main entry point that initializes all subsystems:
- Starts order worker loop
- Establishes market data connection
- Initializes bot engine
- Sets up health monitoring

### 2. Market Data Layer (`src/market/`)
- **dataStream.js**: Manages Alpaca WebSocket connection
- **priceCache.js**: In-memory price storage with staleness checks
- **calendar.js**: Market hours tracking and scheduling

### 3. Bot Engine (`src/engine/`)
- **botEngine.js**: Core bot evaluation logic
- **rules/**: Trading rule implementations
  - `marketHours.js`: Market session filtering
  - `priceThreshold.js`: Price-based triggers
  - `positionLimit.js`: Position size controls
  - `cooldown.js`: Trade frequency limits
  - `dailyLoss.js`: Daily loss protection

### 4. Order Worker (`src/queues/orderWorker.js`)
- Claims queued executions with optimistic locking
- Submits orders to Alpaca
- Polls for order completion
- Handles retries and error recovery

### 5. Broker Layer (`src/broker/`)
- **alpacaClient.js**: Alpaca API wrapper with error handling
- **clientCache.js**: Per-user client caching with credential rotation

## Key Features

### Multi-Tenant Isolation
- Each user gets their own broker client
- Position data isolated by user
- Orders executed through correct accounts

### Real-Time Processing
- Sub-millisecond price updates
- Instant bot evaluation on price ticks
- Efficient in-memory caching

### Fault Tolerance
- Automatic reconnection to market data
- Stuck job recovery
- Order deduplication via client order IDs

### Safety Controls
- Paper trading by default
- Position limits enforced
- Daily loss limits
- Cooldown periods between trades

## Bot System

### Creating a Bot
Bots are created via the API server with:
- Name and description
- Target ticker(s)
- Set of trading rules
- Position sizing parameters

### Rule Pipeline
Rules are evaluated sequentially:
1. Market hours check
2. Price threshold validation
3. Position limit verification
4. Cooldown period check
5. Daily loss limit check

All rules must pass for an execution to be created.

### Execution Flow
```
Price Tick → Bot Evaluation → Rule Pipeline → Execution Created → Order Worker → Broker → Fill
```

## Monitoring & Health

### Health Checks
The worker publishes status every 5 seconds:
- Order worker state
- Alpaca REST API connectivity
- WebSocket connection status
- Market calendar state

### Logging
- Structured logging with component prefixes
- Error tracking with stack traces
- Bot event logging for audit trails

## Development

### Testing
```bash
# Run simulation tests
npm run simulate

# Verify rule implementations
node scripts/verifyTrendFilter.js
node scripts/verifyTwoSidedDecision.js
node scripts/verifyTwoSidedMatrix.js
```

### Adding New Rules
1. Create evaluator in `src/engine/rules/`
2. Add case in `botEngine.js`
3. Update Prisma enum in `server/prisma/schema.prisma`
4. Add validation in API routes
5. Update bot templates (optional)

## Database Schema

The worker shares the database with the API server:
- **Bot**: Trading bot configurations
- **BotRule**: Individual trading rules
- **Execution**: Order tracking and status
- **BotEvent**: Audit log of bot actions
- **WorkerStatus**: Health monitoring data

## Security

### API Keys
- Never stored in environment variables
- Retrieved from database per user
- Automatic rotation support
- Paper/live account separation

### Live Trading Guard
```javascript
if (!paper && process.env.ALLOW_LIVE_TRADING !== 'true') {
  throw new Error('Live trading is disabled')
}
```

## Performance

### Optimizations
- In-memory price caching
- LRU position cache (500 users)
- Delta-based market data subscriptions
- Efficient bot registry reloads

### Scaling
- Single WebSocket per worker
- Horizontal scaling via multiple workers
- Database-driven load distribution

## Troubleshooting

### Common Issues
1. **Market data disconnects**: Check network connectivity
2. **Order failures**: Verify broker credentials
3. **Bot not firing**: Check rule configuration and market hours
4. **High memory usage**: Monitor position cache size

### Debug Mode
Enable verbose logging:
```bash
DEBUG=worker:* npm start
```

## Documentation

- **[WORKER.md](./WORKER.md)**: Detailed technical reference
- **[API Documentation](../server/docs/api-contract.md)**: API endpoints
- **[Developer Guide](../server/docs/developer-guide.md)**: Development setup

## Support

For issues and questions:
1. Check the troubleshooting section
2. Review detailed logs
3. Consult the technical reference (WORKER.md)
4. Check database status and worker health tables
