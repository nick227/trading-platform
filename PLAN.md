# Implementation Plan

## Context

The codebase has two in-flight tracks:
1. **Portfolio Refactor** (in-progress, nearly complete) — new sub-components, `usePortfolio` hook, `pricesService`, server-side engine client and bots service updates. All files exist and are wired up correctly. Not yet committed.
2. **Security Foundation** (not started) — JWT auth, User/Subscription/BrokerAccount models, encrypted Alpaca credentials, per the IMPLEMENTATION-PLAN.md roadmap.

---

## Phase 1 — Finalize Portfolio Refactor

### What to verify before committing

**1. Pagination field name mismatch (high risk)**
`executionsService.getAll()` (line 22) reads `page.pagination?.nextCursor` but the server pagination likely returns `nextOffset` or `cursor`. Verify against `server/src/routes/executions.js` and `server/src/services/executionsService.js`.

**2. `get('/bots')` envelope**
`usePortfolio.js` line 169 calls `get('/bots').catch(() => [])`. The `get()` helper unwraps `{ data }`, so `botsResponse` arrives as an array — confirmed by line 100 in `usePortfolio.js`. No issue.

**3. `get('/strategies')` shape**
Line 177 calls `get('/strategies')` — strategies come from the engine route. Verify the engine strategies endpoint returns an array (or `{ data: [] }`) compatible with `buildStats`.

**4. `portfoliosService.js` import**
Line 2: `import { getPositions } from '../../services/derivePositions.js'` — `getPositions` is exported from that file. Correct.

### Files to commit in this phase
- `app/src/api/client.js`
- `app/src/api/services/executionsService.js`
- `app/src/api/services/portfoliosService.js`
- `app/src/api/services/pricesService.js` (new)
- `app/src/components/StatCard.jsx` (new)
- `app/src/features/Portfolio.jsx`
- `app/src/features/portfolio/` (new: PortfolioHeader, HoldingsTable, ActivityFeed)
- `app/src/hooks/usePortfolio.js` (new)
- `server/src/clients/engine.js`
- `server/src/services/botsService.js`

---

## Phase 2 — Security Foundation (Week 1 of IMPLEMENTATION-PLAN.md)

### 2.1 Database Schema

Add to `server/prisma/schema.prisma`:
```prisma
model User {
  id           String   @id @default(cuid())
  email        String   @unique
  passwordHash String
  fullName     String
  createdAt    DateTime @default(now())
  subscription  Subscription?
  brokerAccount BrokerAccount?
}

model Subscription {
  id     String   @id @default(cuid())
  userId String   @unique
  status String   @default("ACTIVE")
  plan   String   @default("BASIC")
  endsAt DateTime
  user   User @relation(fields: [userId], references: [id])
}

model BrokerAccount {
  id        String   @id @default(cuid())
  userId    String   @unique
  apiKey    String   // AES-256 encrypted
  apiSecret String   // AES-256 encrypted
  paper     Boolean  @default(true)
  user      User @relation(fields: [userId], references: [id])
}
```

Run: `npx prisma migrate dev --name add-auth-models`

### 2.2 Server Dependencies

Install in `server/`:
```
npm install @fastify/jwt @fastify/cookie bcryptjs node-forge
```

### 2.3 Auth Middleware

**File: `server/src/middleware/authenticate.js`**
```javascript
export async function authenticate(request, reply) {
  try {
    const decoded = await request.jwtVerify()
    const user = await prisma.user.findUnique({
      where: { id: decoded.sub },
      include: { subscription: true }
    })
    if (!user || user.subscription?.status !== 'ACTIVE') {
      reply.code(401).send({ error: 'Unauthorized' })
    }
    request.user = user
  } catch {
    reply.code(401).send({ error: 'Unauthorized' })
  }
}
```

### 2.4 Credential Encryption Utility

**File: `server/src/utils/encryption.js`**
- Use `node-forge` for AES-256-GCM encryption
- Key from `ENCRYPTION_KEY` env var
- Exports: `encrypt(plaintext)`, `decrypt(ciphertext)`

### 2.5 Auth Routes

**File: `server/src/routes/auth.js`**
- `POST /api/auth/register` — hash password with bcryptjs, create User + Subscription (trial)
- `POST /api/auth/login` — verify password, issue JWT (httpOnly cookie, 7d expiry)
- `POST /api/auth/logout` — clear cookie

### 2.6 Wire JWT into Fastify

In `server/src/loaders/fastify.js`:
```javascript
await app.register(require('@fastify/jwt'), { secret: process.env.JWT_SECRET })
await app.register(require('@fastify/cookie'))
```

Register auth routes in `server/src/loaders/routes.js`.

### 2.7 Frontend Auth Updates

Remove mock auth from `app/src/api/profileClient.js`.

Update `app/src/app/AuthProvider.jsx`:
- `login(email, password)` → POST `/api/auth/login`
- `logout()` → POST `/api/auth/logout`
- Check session on mount via GET `/api/auth/me`

---

## Phase 3 — Secure Trading Endpoint (Week 2)

**After Phase 2 is merged:**

- `POST /api/trade` protected by `authenticate` middleware
- Decrypt broker credentials from `BrokerAccount` using `encryption.js`
- Forward order to Alpaca API
- Log to `ExecutionAudit`

---

## Verification

### Phase 1 (Portfolio Refactor)
1. Start dev: `npm run dev` from root
2. Navigate to `/portfolio` — should load holdings, stats cards, recent activity
3. Check browser network tab: `/api/executions` pagination works end-to-end
4. Verify engine offline gracefully (stop alpha-engine): prices fall back to stubs, strategies show N/A

### Phase 2 (Auth)
1. `POST /api/auth/register` → 201 with user
2. `POST /api/auth/login` → 200, sets `access_token` cookie
3. Protected endpoint without token → 401
4. Protected endpoint with valid token → 200

---

## Critical Files

| File | Action |
|------|--------|
| `server/prisma/schema.prisma` | Add User, Subscription, BrokerAccount models |
| `server/src/loaders/fastify.js` | Register JWT + cookie plugins |
| `server/src/loaders/routes.js` | Register auth routes |
| `server/src/middleware/authenticate.js` | New: JWT verify + subscription check |
| `server/src/utils/encryption.js` | New: AES-256-GCM encrypt/decrypt |
| `server/src/routes/auth.js` | New: register, login, logout, me |
| `app/src/app/AuthProvider.jsx` | Replace mock auth with real JWT flow |
| `app/src/api/profileClient.js` | Remove stub, add real API calls |
