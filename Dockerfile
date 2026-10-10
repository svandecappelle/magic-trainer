# Magic Trainer: one Node process serves the built app and the multiplayer WebSocket (/ws).

# ---- Build: type-check, run the tests, bundle the app into dist/ ----
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm test && npm run build

# ---- Run ----
FROM node:24-slim
ENV NODE_ENV=production PORT=8787
WORKDIR /app
# The server is TypeScript run with tsx (a dev dependency) and imports the engine from src/,
# so the runtime keeps the installed packages and the sources next to the built app.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json tsconfig.json ./
COPY server ./server
COPY src ./src
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 8787) + '/').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["node_modules/.bin/tsx", "server/index.ts"]
