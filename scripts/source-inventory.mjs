import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const sourceDirectories = [".github", "apps", "infrastructure", "prisma", "scripts", "tests"];
const sourceFiles = [
  ".dockerignore",
  ".env.example",
  ".gitignore",
  "CONTRIBUTING.md",
  "compose.production.yml",
  "Dockerfile",
  "eslint.config.mjs",
  "LICENSE",
  "package-lock.json",
  "package.json",
  "playwright.config.ts",
  "README.md",
  "SECURITY.md",
  "docs/AI-SETUP.md",
  "docs/DEPLOYMENT.md",
  "docs/INTEGRATION-SETUP.md",
  "docs/SNAGTIME-BRAND.md",
  "tsconfig.base.json",
  "vitest.config.ts",
];
const ignoredDirectories = new Set(["node_modules"]);
const ignoredPaths = new Set([
  "apps/web/next-env.d.ts",
  "apps/web/src/app/api/demo/claude/route.ts",
  "apps/web/src/app/demo/demo.module.css",
  "apps/web/src/app/demo/page.tsx",
  "apps/web/src/components/video-demo.tsx",
  "apps/web/src/lib/video-demo.test.ts",
  "apps/web/src/lib/video-demo.ts",
  "prisma/dev.db",
  "prisma/dev.db-journal",
  "prisma/dev.db-shm",
  "prisma/dev.db-wal",
  "scripts/dev-video.mjs",
  "scripts/stripe-video-smoke.mjs",
  "tests/e2e/video-demo.spec.ts",
]);

export function ignoredSourceDirectory(name) {
  return ignoredDirectories.has(name) || name === ".next" || name.startsWith(".next-");
}

export function collect(directory, sourceRoot = root) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredSourceDirectory(entry.name)) continue;
    const absolute = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...collect(absolute, sourceRoot));
    else if (entry.isFile()) {
      const path = relative(sourceRoot, absolute).replaceAll("\\", "/");
      if (!ignoredPaths.has(path) && !path.endsWith(".tsbuildinfo")) files.push(path);
    }
  }
  return files;
}

export function hashSourcePaths(paths, sourceRoot = root, readFile = readFileSync) {
  if (new Set(paths).size !== paths.length) throw new Error("Source inventory contains duplicate paths.");
  const hash = createHash("sha256");
  let bytes = 0;
  for (const path of paths) {
    let content;
    try {
      content = readFile(resolve(sourceRoot, path));
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? ` (${String(error.code)})` : "";
      throw new Error(`Source inventory could not read ${path}${code}.`, { cause: error });
    }
    bytes += content.length;
    hash.update(path, "utf8");
    hash.update(Buffer.from([0]));
    hash.update(content);
    hash.update(Buffer.from("\n", "utf8"));
  }
  return { contract: "UTF-8 relative path + NUL + raw bytes + LF, ordinal path sort", files: paths.length, bytes, sha256: hash.digest("hex").toUpperCase() };
}

export function sourceInventory(sourceRoot = root) {
  return hashSourcePaths(sourcePaths(sourceRoot), sourceRoot);
}

export function sourcePaths(sourceRoot = root) {
  return [...sourceFiles, ...sourceDirectories.flatMap((directory) => collect(resolve(sourceRoot, directory), sourceRoot))].sort();
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  console.log(JSON.stringify(sourceInventory()));
}
