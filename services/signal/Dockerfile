FROM node:20-alpine AS base
WORKDIR /app

FROM base AS deps
COPY services/signal/package*.json ./
RUN npm install --only=production

FROM base AS builder
COPY services/signal/package*.json ./
RUN npm install
COPY services/signal ./
COPY shared ./shared
RUN npm run build

FROM base AS runner
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json
EXPOSE 4002
CMD ["node", "dist/server.js"]
