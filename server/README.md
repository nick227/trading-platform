# Trading Platform Backend

A production-ready trading platform API built with Fastify, Prisma, and MySQL.

## Tech Stack

- **Framework**: Fastify (Node.js)
- **ORM**: Prisma
- **API Spec**: OpenAPI 3.0 (auto-generated)
- **Architecture**: Loaders pattern (declarative, generic)
- **Database**: MySQL

## Quick Start

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Setup environment variables**
   ```bash
   cp .env.example .env
   # Edit .env with your database and engine URLs
   ```

3. **Setup database**
   ```bash
   npm run db:generate  # Generate Prisma client
   npm run db:push      # Push schema to database
   ```

4. **Start development server**
   ```bash
   npm run dev
   ```

The server will be available at `http://localhost:3000` with API docs at `http://localhost:3000/docs`.

## Available Scripts

- `npm run dev` - Start development server with hot reload
- `npm run build` - Build for production
- `npm run start` - Start production server
- `npm run db:generate` - Generate Prisma client
- `npm run db:push` - Push schema changes to database
- `npm run db:studio` - Open Prisma Studio

## API Endpoints

### Core Resources
- `GET /api/strategies` - List strategies
- `GET /api/predictions` - List predictions (may be derived from rankings when engine predictions are unavailable)
- `GET /api/portfolios` - List portfolios
- `GET /api/bots` - List trading bots
- `GET /api/executions` - List trade executions

### Documentation
- `GET /docs` - Interactive Swagger UI
- `GET /docs/json` - OpenAPI JSON spec

## Environment Variables

```bash
DATABASE_URL="mysql://root:password@localhost:3306/trading_platform"
ENGINE_URL="http://localhost:8090"
OLD_ENGINE_URL="http://localhost:8000"
PORT=3000
```

## Architecture

The backend follows a clean architecture pattern:

- **Loaders**: Declarative setup for Fastify, Prisma, and routes
- **Services**: Business logic layer
- **Routes**: API endpoint definitions with validation
- **Utils**: Shared utilities (ID generation, pagination, validation)
- **Clients**: External service integrations (alpha-engine)

## Database Schema

The platform supports:
- Users and portfolios
- Trading strategies and predictions
- Automated trading bots with rules
- Trade executions and events
- Comprehensive audit trails

See `prisma/schema.prisma` for the complete schema.

## Development Notes

- Uses ES modules (`"type": "module"`)
- TypeScript support with strict configuration
- Auto-generated OpenAPI documentation
- Cursor-based pagination for performance
- Soft deletes for data integrity
