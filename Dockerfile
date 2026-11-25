# STAGE 1: Builder
FROM node:22-alpine AS builder

WORKDIR /app

# 1. Copy dependency manifests and Prisma schema (for Docker layer caching)
COPY package*.json ./
COPY prisma ./prisma/
# Uncomment the next line if you have a prisma.config.ts in your project root:
# COPY prisma.config.ts ./

# 2. Download exact dependencies from package-lock.json
RUN npm ci

# 3. Copy TypeScript config and source files
COPY tsconfig*.json ./
COPY src ./src

# 4. Generate the Prisma client & compile TypeScript to dist/
RUN npx prisma generate
RUN npm run build


# STAGE 2: Production Runner
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# 1. Install only production dependencies
COPY package*.json ./
COPY prisma ./prisma/
RUN npm ci --omit=dev

# 2. Copy generated Prisma client and compiled JS from Stage 1
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/dist ./dist

# 3. Switch to non-admin user for security
USER node

# 4. Document the port this container listens on
EXPOSE 4000

# 5. Start the compiled server
CMD ["node", "dist/server.js"]