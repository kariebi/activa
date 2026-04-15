# syntax=docker/dockerfile:1.7

FROM node:20-alpine AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN apk add --no-cache libc6-compat

FROM base AS deps
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/activa/package.json packages/activa/package.json
COPY examples/nextjs/package.json examples/nextjs/package.json
RUN npm ci

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build --workspace @activaq/sdk && npm run build --workspace @activaq/example-nextjs

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
RUN addgroup -S nodejs && adduser -S nextjs -G nodejs

COPY --from=builder --chown=nextjs:nodejs /app/examples/nextjs/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/examples/nextjs/.next/static ./examples/nextjs/.next/static

USER nextjs
EXPOSE 3000

CMD ["node", "examples/nextjs/server.js"]
