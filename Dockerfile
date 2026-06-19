# ---------- Builder ----------
FROM node:20-alpine AS builder
WORKDIR /app

# Install deps first for better layer caching
COPY package*.json ./
RUN npm ci

# Build the TypeScript
COPY . .
RUN npm run build


# ---------- Runtime ----------
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
# Fork 4 Node workers to utilize 4 CPUs (see src/main.ts cluster mode)
ENV CLUSTER_WORKERS=4

# Production deps only (skips devDependencies)
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Compiled output from the builder stage
COPY --from=builder /app/dist ./dist

# Drop root privileges for a safer container
USER node

EXPOSE 3000

# Node picks up CLUSTER_WORKERS at boot
CMD ["node", "dist/main.js"]
