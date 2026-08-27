import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(process.argv[2] || "node_modules");
const forbidden = [/(?:^|\/)node_modules\/prisma$/,/(?:^|\/)node_modules\/@prisma\/config$/,/(?:^|\/)node_modules\/deepmerge-ts$/,/(?:^|\/)node_modules\/effect$/];
const findings = [];
function inspect(directory) {
  if (!existsSync(directory)) throw new Error("Runtime dependency directory is missing.");
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const child = resolve(directory, entry.name); const normalized = child.replaceAll("\\", "/");
    if (forbidden.some((pattern) => pattern.test(normalized))) findings.push(normalized.slice(root.replaceAll("\\", "/").length + 1));
    inspect(child);
  }
}
inspect(root);
if (findings.length) throw new Error(`Runtime dependency tree contains forbidden build tooling: ${findings.sort().join(", ")}.`);
console.log("Runtime dependency filesystem excludes Prisma CLI/config and its affected optional tooling chain.");
