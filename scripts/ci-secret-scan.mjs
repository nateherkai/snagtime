import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";

const root = process.cwd();
const ignoredDirectories = new Set([".git", ".next", ".next-playwright", ".npm-cache", "acceptance", "archives", "dist", "docs", "evidence", "node_modules", "runtime", "tmp"]);
const ignoredFiles = new Set(["apps/web/next-env.d.ts", "apps/web/prisma/dev.db", "prisma/dev.db"]);
const visitedDirectories = new Set();
const ignoredDirectory = (name) => ignoredDirectories.has(name) || name.startsWith(".next-");
const ignoredPrivateEnvironment = (path) => /(?:^|\/)\.env(?:\.[^/]+)?\.local$/.test(path) || /(?:^|\/)\.env\.local$/.test(path);

function filesystemFiles(directory = root) {
  const canonical = realpathSync(directory);
  if (visitedDirectories.has(canonical)) return [];
  visitedDirectories.add(canonical);
  const found = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectory(entry.name)) continue;
    const absolute = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      for (const nested of filesystemFiles(absolute)) found.push(nested);
    }
    else if (entry.isFile()) {
      const path = relative(root, absolute).replaceAll("\\", "/");
      if (!ignoredFiles.has(path) && !ignoredPrivateEnvironment(path) && !path.endsWith(".tsbuildinfo")) found.push(path);
    }
  }
  return found;
}

let files = [];
try {
  files = execFileSync("git", ["ls-files", "-z", "--", "."], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] })
    .split("\0")
    .filter(Boolean)
    .filter((file) => statSync(resolve(root, file), { throwIfNoEntry: false })?.isFile());
} catch {
  files = [];
}
if (files.length === 0) files = filesystemFiles();
files.sort((left, right) => left.localeCompare(right, "en"));
const forbidden = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\b(?:sk|rk)_live_[A-Za-z0-9]{16,}\b/,
  /\bwhsec_[A-Za-z0-9]{24,}\b/,
  /\bAIza[0-9A-Za-z_-]{30,}\b/,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{40,}\b/,
  /\bnpm_[A-Za-z0-9]{36}\b/,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/,
  /\b1\/\/[0-9A-Za-z_-]{20,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{24,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /postgres(?:ql)?:\/\/[^\s:/]+:[^\s@]+@/i,
]; const findings=[];
const documentedCiPlaceholders=["ci-only-ephemeral","CI-App-Database-Password-00000000000001","CI-Worker-Database-Password-0000000001","CI-Monitor-Database-Password-000000001","CI-Migration-Database-Password-0000001"];
const sanitizeCiPlaceholders=(value)=>documentedCiPlaceholders.reduce((current,placeholder)=>current.replaceAll(placeholder,""),value);
const allowedHighEntropy = /(?:sha256|digest|hash|integrity|example|invalid|placeholder|replace-with|test|demo|not-for-production|_key|_idx|000000|\$\{\{|[A-Fa-f0-9]{48,})/i;
const highEntropyLiteral = /["']([A-Za-z0-9+\/_=-]{48,})["']/g;
function containsUndispositionedHighEntropy(value) { for (const match of value.matchAll(highEntropyLiteral)) if (!allowedHighEntropy.test(match[1])) return true; return false; }
function historyContainsUndispositionedHighEntropy(value) {
  let file = "";
  for (const line of value.split(/\r?\n/)) {
    const header = /^diff --git a\/(.+) b\/(.+)$/.exec(line); if (header) { file = header[2]; continue; }
    if (!line.startsWith("+") || line.startsWith("+++") || /(?:\.(?:test|spec)\.[cm]?[jt]s|package-lock\.json|prisma\/migrations\/|prisma\/postgresql\/migrations\/)/.test(file)) continue;
    if (containsUndispositionedHighEntropy(line)) return true;
  }
  return false;
}
for (const file of files) { if (/package-lock\.json$/.test(file)) continue; let source; try { source=readFileSync(file,"utf8"); } catch { continue; } const sanitized = sanitizeCiPlaceholders(source); for (const pattern of forbidden) if (pattern.test(sanitized)) findings.push(file); if (!/(?:\.(?:test|spec)\.[cm]?[jt]s|prisma\/migrations\/|prisma\/postgresql\/migrations\/)/.test(file) && containsUndispositionedHighEntropy(sanitized)) findings.push(`${file}:high-entropy`); }
if (process.env.CI_SECRET_SCAN_HISTORY === "true") {
  const history = execFileSync("git", ["log", "--all", "-p", "--no-ext-diff", "--", "."], { encoding: "utf8", maxBuffer: 128 * 1024 * 1024 })
  const sanitizedHistory = sanitizeCiPlaceholders(history);
  for (const pattern of forbidden) if (pattern.test(sanitizedHistory)) findings.push("git-history");
  if (historyContainsUndispositionedHighEntropy(sanitizedHistory)) findings.push("git-history:high-entropy");
}
if (findings.length) { console.error(`Secret scan rejected ${findings.length} tracked finding(s) in: ${[...new Set(findings)].join(", ")}.`); process.exit(1); }
console.log(`Secret scan passed ${files.length} source files without printing contents.`);
