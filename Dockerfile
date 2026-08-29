# syntax=docker/dockerfile:1.7
FROM node:24.15.0-bookworm-slim@sha256:4e6b70dd6cbfc88c8157ba19aa3d9f9cce6ba4703576d55459e45efcbc9c5f5d AS deps
WORKDIR /src
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
RUN npm ci --ignore-scripts

FROM deps AS builder
ARG BUILD_ID
ENV BUILD_ID=${BUILD_ID}
COPY . .
RUN node -e "if(!/^[a-f0-9]{40,64}$/i.test(process.env.BUILD_ID||''))throw new Error('required immutable BUILD_ID build argument missing or invalid')" \
 && npm run db:generate && npm run db:generate:postgres && npm run worker:build && npm run build

FROM deps AS production-deps
COPY scripts/runtime-dependency-check.mjs ./scripts/runtime-dependency-check.mjs
RUN npm prune --omit=dev --ignore-scripts \
 && rm -rf node_modules/prisma node_modules/@prisma/config node_modules/deepmerge-ts node_modules/effect \
 && node scripts/runtime-dependency-check.mjs node_modules

FROM node:24.15.0-bookworm-slim@sha256:4e6b70dd6cbfc88c8157ba19aa3d9f9cce6ba4703576d55459e45efcbc9c5f5d AS runtime
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=production-deps --chown=node:node /src/node_modules ./node_modules
COPY --from=builder --chown=node:node /src/node_modules/@tempocove/postgresql-client ./node_modules/@tempocove/postgresql-client
COPY --from=builder --chown=node:node /src/node_modules/@tempocove/postgresql-client ./apps/web/node_modules/@tempocove/postgresql-client
COPY --from=builder --chown=node:node /src/apps/web/.next/standalone ./
COPY --from=builder --chown=node:node /src/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=node:node /src/dist ./dist
COPY --chown=node:node scripts/container-entrypoint.mjs ./scripts/container-entrypoint.mjs
COPY --chown=node:node scripts/runtime-dependency-check.mjs ./scripts/runtime-dependency-check.mjs
USER 1000:1000
EXPOSE 3000
ENTRYPOINT ["node","scripts/container-entrypoint.mjs"]
CMD ["node","apps/web/server.js"]

FROM postgres:18.6-bookworm@sha256:7d2695c3aa88e792e8b3b233e7e4adb296a20412c6c0ca361e3edaaacfada108 AS migration
WORKDIR /migrations
COPY --chown=postgres:postgres prisma/postgresql/migrations/202608220100_production_baseline/migration.sql ./migration.sql
COPY --chown=postgres:postgres scripts/migration-entrypoint.sh ./migration-entrypoint.sh
USER postgres
ENTRYPOINT ["/bin/sh","/migrations/migration-entrypoint.sh"]
