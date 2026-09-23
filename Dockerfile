FROM node:24-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY client/package.json client/package.json
COPY server/package.json server/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN npm ci

COPY packages/contracts packages/contracts
COPY server server
RUN npm -w @may-cafe/contracts run build && npm -w @may-cafe/server run build

FROM node:24-bookworm-slim AS server

ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY client/package.json client/package.json
COPY server/package.json server/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN npm ci --omit=dev --ignore-scripts
COPY --from=build /app/packages/contracts/dist packages/contracts/dist
COPY --from=build /app/server/dist server/dist

USER node
EXPOSE 4000
CMD ["node", "server/dist/src/server.js"]
