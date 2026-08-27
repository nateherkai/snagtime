import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const appDirectory = existsSync(resolve(process.cwd(), "next.config.ts")) ? process.cwd() : resolve(process.cwd(), "apps", "web");
const compiled = readFileSync(resolve(appDirectory, ".next", "BUILD_ID"), "utf8").trim();
const runtime = process.env.BUILD_ID || "";
if (!/^[a-f0-9]{40,64}$/i.test(compiled) || runtime !== compiled) throw new Error("Runtime BUILD_ID must exactly match the immutable compiled web identity before listening.");
const require = createRequire(import.meta.url);
const next = require.resolve("next/dist/bin/next");
const child = spawn(process.execPath, [next, "start", ...process.argv.slice(2)], { cwd: appDirectory, env: process.env, stdio: "inherit" });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", (code, signal) => process.exit(signal ? 1 : code ?? 1));
