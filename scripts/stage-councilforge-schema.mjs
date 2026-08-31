import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const baseline = readFileSync(resolve(root, "prisma/postgresql/migrations/202608220100_production_baseline/migration.sql"), "utf8");
const integration = readFileSync(resolve(root, "prisma/postgresql/councilforge-integration.sql"), "utf8");
const isolated = baseline
  .replaceAll('SCHEMA IF NOT EXISTS "public"', 'SCHEMA IF NOT EXISTS "snagtime"')
  .replaceAll("SCHEMA public", "SCHEMA snagtime")
  .replaceAll("search_path=pg_catalog,public", "search_path=pg_catalog,snagtime,public")
  .replaceAll("ALTER SCHEMA public", "ALTER SCHEMA snagtime");
if (isolated.includes("ON SCHEMA public") || isolated.includes("IN SCHEMA public") || isolated.includes("search_path=pg_catalog,public")) throw new Error("CouncilForge schema isolation rewrite incomplete.");
const output = [
  "CREATE SCHEMA IF NOT EXISTS snagtime;",
  "SET LOCAL search_path=snagtime,public;",
  isolated,
  integration,
  "",
].join("\n");
const targetDir = resolve(root, "dist/councilforge");
mkdirSync(targetDir, { recursive: true });
writeFileSync(resolve(targetDir, "snagtime-schema.sql"), output, { mode: 0o600 });
console.log("Staged isolated CouncilForge SnagTime schema without printing credentials.");
