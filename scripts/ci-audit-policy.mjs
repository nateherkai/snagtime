import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const policy = JSON.parse(readFileSync(new URL("../infrastructure/dependency-audit-allowlist.json", import.meta.url), "utf8"));
if (!policy.owner || !policy.disposition || !/^\d{4}-\d{2}-\d{2}$/.test(policy.expires)) throw new Error("Dependency audit policy metadata is incomplete.");
if (Date.now() > Date.parse(`${policy.expires}T23:59:59Z`)) throw new Error("Dependency audit disposition expired.");
if (!process.env.npm_execpath) throw new Error("Run the dependency audit through npm run ci:audit-policy.");
const result = spawnSync(process.execPath, [process.env.npm_execpath, "audit", "--omit=dev", "--json"], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
if (!result.stdout) throw new Error("npm audit produced no machine-readable report.");
const report = JSON.parse(result.stdout);
if ((report.metadata?.vulnerabilities?.critical ?? 0) !== 0) throw new Error("Critical dependency advisory is never allowlisted.");
const foundPackages = Object.keys(report.vulnerabilities ?? {}).sort();
const allowedPackages = [...policy.packages].sort();
if (JSON.stringify(foundPackages) !== JSON.stringify(allowedPackages)) throw new Error("Dependency vulnerability package set differs from the reviewed disposition.");
const advisoryUrls = new Set();
for (const vulnerability of Object.values(report.vulnerabilities ?? {})) {
  for (const via of vulnerability.via ?? []) if (typeof via === "object" && via.url) advisoryUrls.add(via.url);
}
if (JSON.stringify([...advisoryUrls].sort()) !== JSON.stringify([...policy.advisories].sort())) throw new Error("Dependency advisory identity differs from the reviewed disposition.");
console.log(`Dependency audit policy accepted ${foundPackages.length} reviewed findings through ${policy.expires}; the runtime image has a separate filesystem exclusion gate and no report contents were printed.`);
