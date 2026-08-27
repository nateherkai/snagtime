import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const schema = resolve(root, "prisma/postgresql/schema.prisma");
const target = resolve(root, "prisma/postgresql/migrations/202608220100_production_baseline/migration.sql");
const result = spawnSync(process.execPath, [resolve(root, "node_modules/prisma/build/index.js"), "migrate", "diff", "--from-empty", "--to-schema-datamodel", schema, "--script"], { cwd: root, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
if (result.status !== 0 || !result.stdout.includes('CREATE TABLE "Workspace"')) throw new Error("PostgreSQL baseline generation failed closed.");
const guards = readFileSync(resolve(root, "prisma/postgresql/postgres-guards.sql"), "utf8");
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, `${result.stdout.trim()}\n\n${guards.trim()}\n`);
console.log("PostgreSQL baseline migration generated without configuration values.");
