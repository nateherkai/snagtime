import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { PrismaClient } = require("@tempocove/postgresql-client");
const db = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
const roles = [
  ["tempocove_app_login", "TEMPOCOVE_APP_DB_PASSWORD"],
  ["tempocove_worker_login", "TEMPOCOVE_WORKER_DB_PASSWORD"],
  ["tempocove_monitor_login", "TEMPOCOVE_MONITOR_DB_PASSWORD"],
  ["tempocove_migration_login", "TEMPOCOVE_MIGRATION_DB_PASSWORD"],
];

try {
  const contextSecret = process.env.TENANT_CONTEXT_SECRET || "";
  if (Buffer.byteLength(contextSecret) < 32 || contextSecret.includes("\0")) throw new Error("TENANT_CONTEXT_SECRET must be a distinct 32-200 byte runtime secret.");
  const credentials = roles.map(([role, variable]) => ({ role, variable, password: process.env[variable] || "" }));
  for (const { variable, password } of credentials) {
    if (Buffer.byteLength(password) < 32 || Buffer.byteLength(password) > 200 || password.includes("\0")) throw new Error(`${variable} must be a distinct 32-200 byte runtime secret.`);
  }
  if (new Set(credentials.map(({ password }) => password)).size !== credentials.length) throw new Error("PostgreSQL login passwords must be distinct.");
  if (credentials.some(({ password }) => password === contextSecret)) throw new Error("TENANT_CONTEXT_SECRET must be distinct from database login passwords.");
  for (const { role, password } of credentials) {
    const [{ literal }] = await db.$queryRawUnsafe("SELECT quote_literal($1)::text AS literal", password);
    await db.$executeRawUnsafe(`ALTER ROLE ${role} LOGIN PASSWORD ${literal}`);
  }
  await db.$executeRawUnsafe("INSERT INTO tempocove_context_authority(singleton,secret) VALUES (true,$1) ON CONFLICT (singleton) DO UPDATE SET secret=EXCLUDED.secret,installed_at=clock_timestamp()",contextSecret);
  console.log("PostgreSQL migration, app, worker, and monitor logins plus tenant context were provisioned without printing credentials.");
} finally { await db.$disconnect(); }
