FROM node:24-alpine

WORKDIR /app

# Layer dependency dipisah supaya rebuild cepat saat hanya src yang berubah.
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# uid 1000 = user `node`; folder data di host harus dimiliki uid yang sama.
RUN mkdir -p /app/data && chown -R node:node /app
USER node

ENV NODE_ENV=production
CMD ["node", "dist/index.js"]
