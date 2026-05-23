# ---- 1. Production Dependencies ----
FROM node:22-alpine AS prod-deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev


# ---- 2. Build ----
FROM node:22-alpine AS builder
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .

# Build-time args for public env vars (not secrets — these appear in browser)
# Coolify passes these automatically from project env config
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY

ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build


# ---- 3. Runtime ----
FROM node:22-alpine AS runner
RUN apk add --no-cache curl tzdata icu-data-full
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV TZ=Europe/Sofia

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Public assets (favicons, robots.txt, etc.)
COPY --from=builder /app/public ./public

# Build output
COPY --from=builder --chown=nextjs:nodejs /app/.next ./.next

# Production dependencies (next, react, etc.)
COPY --from=prod-deps --chown=nextjs:nodejs /app/node_modules ./node_modules

# package.json needed for next start
COPY --from=builder /app/package.json ./

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME=0.0.0.0

CMD ["npx", "next", "start"]
