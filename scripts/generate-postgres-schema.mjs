import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const sourcePath = resolve(root, "prisma/schema.prisma");
const targetPath = resolve(root, "prisma/postgresql/schema.prisma");
const source = readFileSync(sourcePath, "utf8");
const newline = source.includes("\r\n") ? "\r\n" : "\n";
const output = '  output   = "../../node_modules/@tempocove/postgresql-client"';
const generated = source
  .replace(/generator client \{\r?\n  provider = "prisma-client-js"\r?\n\}/, ["generator client {", '  provider = "prisma-client-js"', output, "}"].join(newline))
  .replace('provider = "sqlite"', 'provider = "postgresql"');
if (generated === source || !generated.includes('provider = "postgresql"') || !generated.includes(output)) throw new Error("PostgreSQL schema derivation failed closed.");
mkdirSync(dirname(targetPath), { recursive: true });
writeFileSync(targetPath, `// GENERATED from prisma/schema.prisma. Do not edit directly.${newline}${generated}`);
console.log("PostgreSQL Prisma schema derived without printing configuration values.");
