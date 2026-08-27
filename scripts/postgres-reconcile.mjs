import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { PrismaClient } = require("@tempocove/postgresql-client");
const db = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
try {
  const tables = await db.$queryRawUnsafe("SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations' ORDER BY tablename");
  const inventory = [];
  for (const { tablename } of tables) {
    const quoted = `"${tablename.replaceAll('"', '""')}"`;
    const rows = await db.$queryRawUnsafe(`SELECT to_jsonb(t)::text AS value FROM ${quoted} t ORDER BY to_jsonb(t)::text`);
    const sha256 = createHash("sha256").update(rows.map((row) => row.value).join("\n"), "utf8").digest("hex").toUpperCase();
    inventory.push({ table: tablename, count: rows.length, sha256 });
  }
  const aggregateSha256 = createHash("sha256").update(JSON.stringify(inventory), "utf8").digest("hex").toUpperCase();
  console.log(JSON.stringify({ tables: inventory.length, aggregateSha256, inventory }));
} finally {
  await db.$disconnect();
}
