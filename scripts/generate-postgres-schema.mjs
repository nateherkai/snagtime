import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const sourcePath = resolve(root, "prisma/schema.prisma");
const targetPath = resolve(root, "prisma/postgresql/schema.prisma");
const source = readFileSync(sourcePath, "utf8");
const generated = source
  .replace('generator client {\n  provider = "prisma-client-js"\n}', 'generator client {\n  provider = "prisma-client-js"\n  output   = "../../node_modules/@tempocove/postgresql-client"\n}')
  .replace('provider = "sqlite"', 'provider = "postgresql"');
if (generated === source || !generated.includes('provider = "postgresql"')) throw new Error("PostgreSQL schema derivation failed closed.");
mkdirSync(dirname(targetPath), { recursive: true });
writeFileSync(targetPath, `// GENERATED from prisma/schema.prisma. Do not edit directly.\n${generated}`);
console.log("PostgreSQL Prisma schema derived without printing configuration values.");
