FROM node:26-slim AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

FROM node:26-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# The photos volume copies this folder's ownership when it is first created
RUN mkdir -p users_photos && chown node:node users_photos
USER node
EXPOSE 5000
CMD ["node", "index.js"]