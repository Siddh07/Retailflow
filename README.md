# RetailFlow API

Backend API for RetailFlow built with Express, TypeScript, PostgreSQL, and Prisma.

## Getting Started

### Prerequisites
- Node.js
- PostgreSQL 17

### Environment Setup
Copy the example environment file and configure your credentials:
```bash
cp .env.example .env
cp .env.example .env.test
```

### Database Setup
```bash
npx prisma migrate dev
npm run seed
```

### Scripts
```bash
# Development
npm run dev

# Type check
npm run typecheck
npm run typecheck:tests

# Test
npm test

# Build & Start
npm run build
npm start
```

