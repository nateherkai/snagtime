import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const generated = ["prisma/postgresql/schema.prisma", "prisma/postgresql/migrations/202608220100_production_baseline/migration.sql"];
const digest = () => createHash("sha256").update(generated.map((path) => `${path}\0${readFileSync(path, "utf8")}\n`).join(""), "utf8").digest("hex");
const before = digest();
for (const script of ["scripts/generate-postgres-schema.mjs", "scripts/generate-postgres-migration.mjs"]) {
  const result = spawnSync(process.execPath, [script], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
if (digest() !== before) throw new Error("Generated PostgreSQL schema or baseline drifted from its committed source.");
console.log("Generated PostgreSQL schema and baseline are byte-identical to source transforms.");
