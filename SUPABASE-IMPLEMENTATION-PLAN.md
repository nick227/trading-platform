# Supabase Implementation Plan with Alpha Engine Integration

## Priority One: Single Trade Milestone

### Core Truth Milestone
**Can one authenticated user connect Alpaca and execute one successful paper trade?**

### Current State Analysis
- Alpha Engine connected via `http://127.0.0.1:8090` (alphaEngineService.js)
- STUB_USER_ID = 'usr_stub_demo' in auth.js
- Broker credentials stored but no real user object
- Need: **Connect Alpaca → Run $10 Test Trade**

### Essential Schema (Production-Safe)
```sql
-- Use Supabase auth.users as primary identity
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  alpaca_user_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE broker_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  environment TEXT DEFAULT 'paper' CHECK (environment IN ('paper', 'live')),
  api_key_ciphertext TEXT NOT NULL, -- Encrypted
  api_secret_ciphertext TEXT NOT NULL, -- Encrypted
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'error', 'disabled')),
  last_error TEXT,
  last_verified_at TIMESTAMPTZ,
  last_verified_status TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);

CREATE TABLE bots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  enabled BOOLEAN DEFAULT TRUE,
  max_position_pct NUMERIC DEFAULT 5.0,
  max_daily_trades INTEGER DEFAULT 10,
  max_notional NUMERIC DEFAULT 25.0, -- Max $ per trade
  min_confidence NUMERIC DEFAULT 0.7, -- Configurable threshold
  allowed_symbols TEXT[], -- Whitelist of symbols
  daily_failure_cap INTEGER DEFAULT 3, -- Stop after X failures
  cooldown_minutes INTEGER DEFAULT 30, -- Cooldown after failures
  config JSONB,
  status TEXT DEFAULT 'idle',
  last_error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  bot_id UUID REFERENCES bots(id) ON DELETE SET NULL,
  ticker TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('buy', 'sell')),
  quantity NUMERIC NOT NULL,
  alpaca_order_id TEXT,
  status TEXT DEFAULT 'queued',
  filled_quantity NUMERIC DEFAULT 0,
  filled_price NUMERIC,
  error TEXT,
  request_id TEXT UNIQUE, -- Idempotency key
  submitted_at TIMESTAMPTZ DEFAULT NOW(),
  filled_at TIMESTAMPTZ,
  source TEXT DEFAULT 'manual' CHECK (source IN ('manual', 'bot', 'test')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  metadata JSONB,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Row Level Security (RLS + Encryption)
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE broker_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE bots ENABLE ROW LEVEL SECURITY;
ALTER TABLE executions ENABLE ROW LEVEL SECURITY;

-- Users can only access their own data
CREATE POLICY "Users can view own profile" ON profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON profiles
  FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Users can manage own broker connections" ON broker_connections
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users can manage own bots" ON bots
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users can view own executions" ON executions
  FOR SELECT USING (auth.uid() = user_id);

-- Executions inserted by backend service role only
CREATE POLICY "Service role can insert executions" ON executions
  FOR INSERT WITH CHECK (true);

-- Audit logs: backend service role only
CREATE POLICY "Service role can insert audit logs" ON audit_logs
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Users can view own audit logs" ON audit_logs
  FOR SELECT USING (auth.uid() = user_id);
```

#### 2. Production-Safe Encryption
```javascript
// Server-side encryption (service role only)
import crypto from 'crypto'

// Must be exactly 32 bytes for AES-256
const ENCRYPTION_KEY = Buffer.from(process.env.BROKER_ENCRYPTION_KEY, 'hex')
if (ENCRYPTION_KEY.length !== 32) {
  throw new Error('BROKER_ENCRYPTION_KEY must be 32 bytes (64 hex chars)')
}

function encrypt(text) {
  const iv = crypto.randomBytes(16) // 16-byte IV for GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', ENCRYPTION_KEY, iv)
  
  let encrypted = cipher.update(text, 'utf8', 'hex')
  encrypted += cipher.final('hex')
  
  const authTag = cipher.getAuthTag()
  
  return {
    encrypted,
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex')
  }
}

function decrypt(encryptedData) {
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    ENCRYPTION_KEY,
    Buffer.from(encryptedData.iv, 'hex')
  )
  
  decipher.setAuthTag(Buffer.from(encryptedData.authTag, 'hex'))
  
  let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8')
  decrypted += decipher.final('utf8')
  
  return decrypted
}

// Store broker connection (server-side only)
async function storeBrokerConnection(userId, apiKey, apiSecret) {
  const encryptedKey = encrypt(apiKey)
  const encryptedSecret = encrypt(apiSecret)
  
  return await supabaseService // Service role client
    .from('broker_connections')
    .insert([{
      user_id: userId,
      api_key_ciphertext: JSON.stringify(encryptedKey),
      api_secret_ciphertext: JSON.stringify(encryptedSecret),
      environment: 'paper'
    }])
}
```

## Production-Safe Architecture

### Responsibilities
**Supabase:**
- PostgreSQL DB
- Auth (auth.users)
- Realtime events
- Backups

**Fastify:**
- Business logic
- Billing webhooks
- Bot APIs
- Secret encryption/decryption
- Admin actions

**Worker:**
- Scheduled bots
- Execute trades
- Sync broker status
- Retry failures

**Alpha Engine:**
- Ranks/signals/predictions only

## Vertical Slice Build Order (Value First)

### Slice 1: User Registration & Login
- Create Supabase project
- Set up auth signup/login flow
- Create profiles table (references auth.users)
- Test: stranger can create account

### Slice 2: Encrypted Broker Storage
- Add broker_connections table with health tracking
- Implement AES-256-GCM encryption/decryption
- Create broker connection endpoint
- Test: user can connect Alpaca paper keys

### Slice 3: Single Test Trade
- Create `/test-trade` with fractional shares ($10 SPY)
- Add client idempotency and risk guardrails
- Implement execution logging
- Test: click Test Trade → see order in Alpaca

### Slice 4: Execution History UI
- Add execution logs endpoint
- Create basic execution history view
- Add audit log visibility
- Test: see execution history in your UI

### Slice 5: Alpha Engine Integration
- Alpha Engine top signal triggers execution service
- Add configurable confidence thresholds
- Validate complete automation
- Test: Alpha signal → paper trade executes

**Success Milestone**: When all 5 slices work, you've crossed into real product territory.

### Day 1: Environment Setup
```bash
# .env (server-side only - NEVER expose to frontend)
DATABASE_URL=postgresql://postgres:[password]@db.your-project.supabase.co:5432/postgres
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-role-key  # Server-only
BROKER_ENCRYPTION_KEY=64-hex-character-string-32-bytes
ALPACA_PAPER_API_KEY=your-alpaca-paper-key
ALPACA_PAPER_API_SECRET=your-alpaca-paper-secret

# Frontend .env (public only)
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key  # Frontend only
```

```javascript
// server/src/clients/supabase.js
import { createClient } from '@supabase/supabase-js'

// Service role client (server-side only)
export const supabaseService = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
)

// Auth client (for user verification)
export const supabaseAuth = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)
```

### Day 2: Auth Integration
```javascript
// server/src/middleware/auth.js
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

export async function authenticate(request, reply) {
  const token = request.headers.authorization?.replace('Bearer ', '')
  
  if (!token) {
    return reply.code(401).send({ error: 'No token provided' })
  }
  
  const { data: { user }, error } = await supabase.auth.getUser(token)
  
  if (error || !user) {
    return reply.code(401).send({ error: 'Invalid token' })
  }
  
  request.user = user
}
```

### Day 4: Test Trade Endpoint (Fractional + Client Idempotency)
```javascript
// server/src/routes/testTrade.js
import { supabaseService, supabaseAuth } from '../clients/supabase.js'

export default async function testTradeRoutes(app) {
  app.post('/test-trade', { preHandler: [authenticate] }, async (request, reply) => {
    const { ticker = 'SPY', notional = 10 } = request.body // $10 default, not 1 share
    const requestId = request.headers['idempotency-key'] // Client-generated idempotency
    
    if (!requestId) {
      return reply.code(400).send({ error: 'Idempotency-Key header required' })
    }
    
    try {
      // Get encrypted broker credentials
      const { data: broker, error: brokerError } = await supabaseService
        .from('broker_connections')
        .select('*')
        .eq('user_id', request.user.id)
        .eq('status', 'active')
        .single()
      
      if (brokerError || !broker) {
        await logAudit(request.user.id, 'test_trade_failed', { 
          error: 'No broker connection', 
          ticker 
        })
        return reply.code(400).send({ error: 'No active broker connection found' })
      }
      
      // Decrypt credentials
      const apiKey = decrypt(JSON.parse(broker.api_key_ciphertext))
      const apiSecret = decrypt(JSON.parse(broker.api_secret_ciphertext))
      
      // Check for duplicate request (idempotency)
      const { data: existing } = await supabaseService
        .from('executions')
        .select('id')
        .eq('request_id', requestId)
        .single()
      
      if (existing) {
        return reply.code(409).send({ error: 'Duplicate request', requestId })
      }
      
      // Risk guardrails (hard constraints)
      if (broker.environment !== 'paper' && process.env.ALLOW_LIVE_TRADING !== 'true') {
        throw new Error('Live trading disabled')
      }
      
      if (notional > 25) { // Hard max notional
        throw new Error('Trade notional exceeds maximum')
      }
      
      // Get current price for fractional calculation
      const alpacaClient = new AlpacaClient({ apiKey, apiSecret, paper: true })
      const quote = await alpacaClient.getLatestQuote(ticker)
      const price = parseFloat(quote.ask_price || quote.close_price)
      const quantity = notional / price // Fractional shares
      
      const order = await alpacaClient.submitOrder({
        ticker,
        side: 'buy',
        qty: quantity,
        type: 'market',
        clientOrderId: `test_${request.user.id.slice(0, 8)}_${Date.now()}`
      })
      
      // Update broker health status
      await supabaseService
        .from('broker_connections')
        .update({
          last_verified_at: new Date().toISOString(),
          last_verified_status: 'success'
        })
        .eq('user_id', request.user.id)
      
      // Log execution with service role
      const { data: execution, error: execError } = await supabaseService
        .from('executions')
        .insert([{
          user_id: request.user.id,
          ticker,
          direction: 'buy',
          quantity,
          notional,
          alpaca_order_id: order.alpacaOrderId,
          status: 'submitted',
          request_id: requestId,
          source: 'test'
        }])
        .select()
        .single()
      
      // Log audit
      await logAudit(request.user.id, 'test_trade_submitted', {
        execution_id: execution.id,
        ticker,
        quantity,
        alpaca_order_id: order.alpacaOrderId
      })
      
      return { 
        execution, 
        order, 
        requestId,
        message: 'Test trade executed successfully' 
      }
      
    } catch (error) {
      await logAudit(request.user.id, 'test_trade_failed', {
        error: error.message,
        ticker,
        quantity,
        requestId
      })
      
      return reply.code(500).send({ 
        error: 'Trade execution failed', 
        requestId,
        details: error.message 
      })
    }
  })
}

// Audit logging helper
async function logAudit(userId, action, metadata) {
  await supabaseService
    .from('audit_logs')
    .insert([{
      user_id: userId,
      action,
      metadata,
      created_at: new Date().toISOString()
    }])
}
```

### Day 5: Alpha Engine Integration (Safe Architecture)
```javascript
// server/src/services/executionService.js
// This service handles ALL trade execution - Alpha Engine never trades directly

export class ExecutionService {
  async executeSignal(userId, signal, source = 'bot') {
    const requestId = uuidv4()
    
    // 1. Get user's bot configuration
    const { data: bot } = await supabaseService
      .from('bots')
      .select('*')
      .eq('user_id', userId)
      .eq('enabled', true)
      .single()
    
    if (!bot) {
      throw new Error('No active bot found for user')
    }
    
    // 2. Risk checks (platform decides permission)
    if (signal.confidence < bot.min_confidence) {
      throw new Error(`Signal confidence ${signal.confidence} below threshold ${bot.min_confidence}`)
    }
    
    // Symbol whitelist check
    if (bot.allowed_symbols.length > 0 && !bot.allowed_symbols.includes(signal.symbol)) {
      throw new Error(`Symbol ${signal.symbol} not in allowed list`)
    }
    
    // Daily failure cap check
    const todayFailures = await this.getTodayFailures(userId)
    if (todayFailures >= bot.daily_failure_cap) {
      throw new Error('Daily failure cap exceeded')
    }
    
    // 3. Get encrypted broker credentials
    const { data: broker } = await supabaseService
      .from('broker_connections')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'active')
      .single()
    
    if (!broker) {
      throw new Error('No active broker connection')
    }
    
    // 4. Execute trade (platform sends order)
    const apiKey = decrypt(JSON.parse(broker.api_key_ciphertext))
    const apiSecret = decrypt(JSON.parse(broker.api_secret_ciphertext))
    
    // Calculate quantity with notional limits
    const quote = await alpacaClient.getLatestQuote(signal.symbol)
    const price = parseFloat(quote.ask_price || quote.close_price)
    const maxNotional = Math.min(bot.max_notional, 25) // Hard guardrail
    const quantity = Math.min(
      maxNotional / price,
      bot.max_position_pct / 100
    )
    
    const alpacaClient = new AlpacaClient({ apiKey, apiSecret, paper: true })
    const order = await alpacaClient.submitOrder({
      ticker: signal.symbol,
      side: signal.direction,
      qty: quantity,
      type: 'market',
      clientOrderId: `bot_${userId.slice(0, 8)}_${Date.now()}`
    })
    
    // 5. Log execution
    const { data: execution } = await supabaseService
      .from('executions')
      .insert([{
        user_id: userId,
        bot_id: bot.id,
        ticker: signal.symbol,
        direction: signal.direction,
        quantity,
        alpaca_order_id: order.alpacaOrderId,
        status: 'submitted',
        request_id: requestId,
        source
      }])
      .select()
      .single()
    
    // 6. Audit
    await logAudit(userId, 'bot_trade_submitted', {
      execution_id: execution.id,
      signal_id: signal.id,
      confidence: signal.confidence
    })
    
    return { execution, order, signal }
  }
}

// Alpha Engine integration (safe separation)
export class AlphaEngineBridge {
  async executeTopSignal(userId) {
    // Alpha Engine provides signal only
    const signals = await alphaEngineService.getActiveSignals()
    const topSignal = signals[0]
    
    if (!topSignal) {
      throw new Error('No active signals available')
    }
    
    // Execution service handles everything else
    const executionService = new ExecutionService()
    return await executionService.executeSignal(userId, topSignal, 'bot')
  }
}
```

## Success Validation

### Complete POC Validation Test
```javascript
// scripts/test-complete-poc.js
async function testCompletePOC() {
  console.log('🎯 Testing Complete POC Flow...')
  
  try {
    // 1. User registration and authentication
    const { data: { user }, error } = await supabase.auth.signInWithPassword({
      email: 'test@example.com',
      password: 'test123456'
    })
    
    if (error) throw error
    console.log(`✅ User authenticated: ${user.email}`)
    
    // 2. Verify broker connection (encrypted storage)
    const { data: broker } = await supabaseService
      .from('broker_connections')
      .select('*')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .single()
    
    if (!broker) throw new Error('No active broker connection found')
    console.log(`✅ Broker connection verified: ${broker.environment}`)
    
    // 3. Test Alpaca connection
    const connectionTest = await fetch('http://localhost:3001/test-connection', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${user.session.access_token}`,
        'Content-Type': 'application/json'
      }
    })
    
    const { account } = await connectionTest.json()
    console.log(`✅ Alpaca connection: $${parseFloat(account.buying_power).toLocaleString()} buying power`)
    
    // 4. Execute test trade (fractional + client idempotency)
    const tradeResponse = await fetch('http://localhost:3001/test-trade', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${user.session.access_token}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `test_${Date.now()}_${Math.random()}` // Client-generated
      },
      body: JSON.stringify({ ticker: 'SPY', notional: 10 }) // $10 fractional, not 1 share
    })
    
    const { execution, order, requestId } = await tradeResponse.json()
    console.log(`✅ Test trade executed: ${order.alpacaOrderId} (request: ${requestId})`)
    
    // 5. Verify trade in Alpaca
    const alpacaClient = new AlpacaClient({
      apiKey: decrypt(JSON.parse(broker.api_key_ciphertext)),
      apiSecret: decrypt(JSON.parse(broker.api_secret_ciphertext)),
      paper: true
    })
    
    const verifiedOrder = await alpacaClient.getOrder(order.alpacaOrderId)
    console.log(`✅ Order verified in Alpaca: ${verifiedOrder.status}`)
    
    // 6. Check audit logs
    const { data: audits } = await supabaseService
      .from('audit_logs')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(5)
    
    console.log(`✅ Audit logs: ${audits.length} events recorded`)
    audits.forEach(audit => {
      console.log(`   - ${audit.action}: ${audit.created_at}`)
    })
    
    // 7. Alpha Engine signal test (Day 5)
    const alphaResponse = await fetch('http://localhost:3001/alpha-signal-trade', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${user.session.access_token}`,
        'Content-Type': 'application/json'
      }
    })
    
    const { execution: alphaExecution, signal } = await alphaResponse.json()
    console.log(`✅ Alpha Engine trade: ${signal.symbol} @ ${signal.confidence} confidence`)
    
    console.log('🎉 Complete POC validated - All systems working!')
    
  } catch (error) {
    console.error('❌ POC test failed:', error.message)
    throw error
  }
}
```

## Why This Works

### Production-Safe Security
- **Supabase Auth**: Uses auth.users as primary identity
- **Encryption**: Broker secrets encrypted server-side only
- **RLS**: Database-enforced data ownership
- **Service Role**: Sensitive operations use service key only

### Minimal Complexity
- **Single Trade Focus**: No overengineering before proof
- **Worker Architecture**: Clean separation of concerns
- **Prisma Integration**: Keep existing tooling
- **Alpha Engine Bridge**: Simple signal-to-execution flow

### Business Value
- **Trust Signal**: Supabase brand recognition for users
- **Security Posture**: SOC 2 compliance out of the box
- **Development Speed**: 5-day timeline to working POC
- **Scalability**: Architecture supports growth

## Real Milestone Scoreboard

**When these are true, you've crossed into real product territory:**

1. ✅ **Stranger can create account** → Supabase auth working
2. ✅ **Connect Alpaca Markets paper keys** → Encrypted storage working
3. ✅ **Click Test Trade** → $10 fractional SPY executes
4. ✅ **See order in Alpaca** → Real execution confirmed
5. ✅ **See execution history in your UI** → User-facing value

**That is huge.**

### Risk Mitigation
- **Paper Trading Only**: No real money at risk
- **Conservative Position Sizes**: 1 share max for testing
- **Error Handling**: Clear error messages and logging
- **Manual Override**: Can disable bots anytime

## Strategic Architecture Decision

**For now:**
- Trading Platform on Supabase = yes (needs auth, users, billing, secure data)
- Alpha Engine remains separate = yes (already functioning)
- HTTP bridge integration = yes (already present)

**Do not migrate Alpha Engine** until customer platform proves traction.

**Bridge first. Migrate later if justified.**

This avoids distracting rewrites and delivers value fastest.

## Next Steps After POC

1. **Add Bot Scheduling**: Worker-based automation
2. **Implement Billing**: Subscription management  
3. **Enhanced Risk Controls**: Daily loss limits, circuit breakers
4. **Scale Alpha Engine Integration**: More signals, strategies
5. **Production Hardening**: Monitoring, alerts, compliance

The goal is simple: **Connect Alpaca → Run Test Trade → Validate Success**. Everything else can wait.
