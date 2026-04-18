# Trading Platform

A monorepo containing a React frontend (app) and Fastify backend (server) for a trading platform.

## Project Structure

```
trading-platform/
├── app/                    # React + Vite frontend
│   ├── src/
│   ├── e2e/               # Playwright E2E tests
│   ├── playwright.config.js
│   ├── vite.config.js
│   ├── package.json
│   └── README.md
│
├── server/                # Fastify backend API
│   ├── src/
│   ├── prisma/            # Database schema & migrations
│   ├── test/              # API contract tests
│   ├── package.json
│   └── README.md
│
├── .gitignore            # Monorepo .gitignore
├── package.json          # Root package.json with workspaces
└── README.md             # This file
```

## Setup

Install dependencies for all workspaces:

```bash
npm install
```

Or install specific workspace:

```bash
npm install --workspace=app
npm install --workspace=server
```

## Development

### Frontend

```bash
npm run dev --workspace=app
```

Runs at `http://localhost:5173` with Vite dev server.

### Backend

```bash
npm run dev --workspace=server
```

Runs at `http://localhost:3001` with Fastify.

## Testing

### Unit Tests

Frontend:
```bash
npm test --workspace=app
```

Backend:
```bash
npm test --workspace=server
```

### E2E Tests (Frontend)

```bash
npm run e2e --workspace=app
```

Runs Playwright tests in headless mode. For visible browser:

```bash
npm run e2e:headed --workspace=app
```

### All Tests

```bash
npm test --workspaces
```

## Scripts at Root

- `npm run dev` - Start frontend dev server
- `npm run test` - Run all tests (app + server)
- `npm run test:app` - Frontend unit tests only
- `npm run test:server` - Backend tests only
- `npm run e2e` - Frontend E2E tests
- `npm run install:all` - Install all dependencies

## Tech Stack

### Frontend (`app/`)
- React 18
- Vite 5
- React Router
- Chart.js
- **Testing**: Vitest + React Testing Library + Playwright

### Backend (`server/`)
- Fastify 4
- Prisma ORM
- MySQL (configured)
- **Testing**: Vitest + Supertest

## Git Workflow

This is a monorepo managed as a single Git repository at the root level.

- Both `app/` and `server/` are tracked in the same repo
- Use commits that affect both directories when necessary
- Use feature branches for feature work

Example:
```bash
git checkout -b feature/trade-execution
# Make changes in app/ and/or server/
git add -A
git commit -m "feat: add trade execution endpoint and UI"
```

## Database

Configure database connection in `server/` via `.env`:

```
DATABASE_URL="mysql://user:password@localhost:3306/trading_platform"
```

Run migrations:

```bash
npm run db:push --workspace=server
```

## Documentation

- [Backend API Documentation](./server/docs/)
- [Frontend Development Guide](./app/README.md)

## API Endpoints

See backend routes for full API specification:
- `/api/strategies` - Strategy management
- `/api/executions` - Trade executions
- `/api/portfolios` - Portfolio data
- `/api/predictions` - Predictions/signals
- `/api/bots` - Trading bots

Swagger UI available at `http://localhost:3001/docs`
