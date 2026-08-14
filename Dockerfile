FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-alpine
RUN apk add --no-cache dumb-init
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY data ./data

# storage/tmp-uploads/ — временное хранилище архивов вайтов между приёмом
# файла от пользователя и обработкой в BullMQ-воркере (см.
# src/utils/tmpStorage.ts). Создаём и передаём владение node-пользователю
# заранее: /app принадлежит root, а сам процесс ниже запускается не от root.
RUN mkdir -p storage/tmp-uploads && chown -R node:node storage

# запуск не от root
USER node

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]