FROM node:20-alpine AS base

WORKDIR /app

# Dependências de produção
FROM base AS deps
COPY services/api-gateway/package*.json ./
RUN npm install --only=production

# Build
FROM base AS builder
COPY services/api-gateway/package*.json ./
RUN npm install
COPY services/api-gateway ./
COPY shared ./shared
RUN npm run build

# Produção
FROM base AS runner
ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json

EXPOSE 4000

CMD ["node", "dist/server.js"]
