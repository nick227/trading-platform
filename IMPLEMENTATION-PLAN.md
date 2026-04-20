# Trading Platform Implementation Plan

## Security Foundation (Week 1)

### Essential Dependencies
```json
{
  "@fastify/jwt": "^7.2.4",
  "@fastify/cookie": "^9.3.1", 
  "bcryptjs": "^2.4.3",
  "stripe": "^16.12.0",
  "node-forge": "^1.3.1"
}
```

### Database Schema
```prisma
model User {
  id           String   @id @default(cuid())
  email        String   @unique
  passwordHash String
  fullName     String
  createdAt    DateTime @default(now())
  
  subscription Subscription?
  brokerAccount BrokerAccount?
}

model Subscription {
  id     String   @id @default(cuid())
  userId String   @unique
  status String   @default("ACTIVE")
  plan   String   @default("BASIC")
  endsAt DateTime
  
  user User @relation(fields: [userId], references: [id])
}

model BrokerAccount {
  id        String   @id @default(cuid())
  userId    String   @unique
  apiKey    String   // Encrypted
  apiSecret String   // Encrypted
  paper     Boolean  @default(true)
  
  user User @relation(fields: [userId], references: [id])
}
```

### Core Auth Middleware
```javascript
async function authenticate(request, reply) {
  const token = request.cookies.access_token
  const decoded = await request.jwtVerify()
  const user = await prisma.user.findUnique({
    where: { id: decoded.sub },
    include: { subscription: true }
  })
  
  if (!user || user.subscription.status !== 'ACTIVE') {
    reply.code(401).send({ error: 'Unauthorized' })
  }
  request.user = user
}
```

## Secure Trading (Week 2)

### Trading Endpoint
```javascript
app.post('/api/trade', { preHandler: [authenticate] }, async (request, reply) => {
  const { symbol, quantity, side } = request.body
  
  const brokerAccount = await prisma.brokerAccount.findUnique({
    where: { userId: request.user.id }
  })
  
  const { apiKey, apiSecret } = decryptCredentials(brokerAccount)
  
  const order = await alpaca.createOrder({
    symbol, quantity, side,
    type: 'market', time_in_force: 'day'
  })
  
  return order
})
```

### Key Security Changes
- HTTPS enforced (Railway provides SSL)
- Alpaca keys encrypted server-side
- All trading requires valid JWT + active subscription
- Rate limiting on auth endpoints

## Production Hardening (Week 3-4)

### Security Enhancements
- Rate limiting implementation
- Audit logging for all trades
- Server-side risk limits
- Secure error handling

### Frontend Updates
- Remove mock authentication
- Update AuthProvider for JWT tokens
- Add subscription status UI
- Secure API key management

## Deployment Strategy

### Environment Setup
- Railway automatic HTTPS
- Environment variables for JWT secrets
- Database encryption keys
- Stripe API keys

### Migration Steps
1. Update database schema
2. Implement auth middleware
3. Encrypt existing API keys
4. Update frontend authentication
5. Enable HTTPS enforcement

## Success Metrics
- Secure user authentication
- Encrypted broker credentials
- Working trading endpoints
- Subscription-based access control
- HTTPS-only communication
