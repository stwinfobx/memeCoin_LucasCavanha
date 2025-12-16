FROM node:20-alpine AS base

WORKDIR /app

FROM base AS deps
COPY services/validator/package*.json ./
RUN npm install --only=production

FROM base AS builder
COPY services/validator/package*.json ./
RUN npm install
COPY services/validator ./
COPY shared ./shared
RUN npm run build

FROM base AS runner
ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json

EXPOSE 4001

CMD ["node", "dist/server.js"]
