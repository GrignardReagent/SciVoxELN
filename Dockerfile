# SciVox ELN — production image
# node:sqlite (built-in driver) requires Node >= 22.5
FROM node:22-slim

ENV NODE_ENV=production \
    NODE_NO_WARNINGS=1 \
    PORT=3000 \
    DATA_DIR=/app/data

WORKDIR /app

# Install dependencies first (better layer caching)
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# App source
COPY src ./src
COPY public ./public

# Persist the database + uploaded scans on a volume
RUN mkdir -p /app/data && chown -R node:node /app
VOLUME ["/app/data"]

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD node -e "fetch('http://localhost:'+ (process.env.PORT||3000) +'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/index.js"]
