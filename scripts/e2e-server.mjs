import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runtime = resolve(root, "runtime", "playwright");
const database = resolve(process.env.PLAYWRIGHT_DATABASE_PATH || resolve(runtime, "e2e.db"));
if (relative(runtime, database).startsWith("..")) throw new Error("E2E database escaped its runtime directory.");
mkdirSync(runtime, { recursive: true });
for (const suffix of ["", "-journal", "-shm", "-wal"]) rmSync(`${database}${suffix}`, { force: true });
rmSync(resolve(root, "apps", "web", ".next-playwright"), { recursive: true, force: true });

const portArgument = process.argv.find((item) => item.startsWith("--port="));
const port = portArgument?.slice("--port=".length) || "3210";
const databaseUrl = `file:${database.replaceAll("\\", "/")}`;
const env = {
  ...process.env,
  NODE_ENV: "test",
  DATABASE_PROVIDER: "sqlite",
  DATABASE_URL: databaseUrl,
  DEMO_MODE: "true",
  DEMO_HOST_EMAIL: process.env.PLAYWRIGHT_ORGANIZER_EMAIL,
  DEMO_HOST_PASSWORD: process.env.PLAYWRIGHT_ORGANIZER_PASSWORD,
  AUTH_SECRET: process.env.AUTH_SECRET,
  EMAIL_TOKEN_SECRET: process.env.EMAIL_TOKEN_SECRET,
  TOKEN_ENCRYPTION_KEY: process.env.TOKEN_ENCRYPTION_KEY,
  NEXT_PUBLIC_APP_URL: `http://127.0.0.1:${port}`,
  CALENDAR_PROVIDER: "local",
  PAYMENTS_PROVIDER: "stub",
  EMAIL_PROVIDER: "local",
  OUTBOX_WORKER_ENABLED: "true",
  HOST: "127.0.0.1",
  PORT: port,
  NEXT_DIST_DIR: ".next-playwright",
};
for (const name of ["DEMO_HOST_EMAIL", "DEMO_HOST_PASSWORD", "AUTH_SECRET", "EMAIL_TOKEN_SECRET", "TOKEN_ENCRYPTION_KEY"]) {
  if (!env[name]) throw new Error(`Playwright configuration did not provide ${name}.`);
}

function checked(script, args) {
  const result = spawnSync(process.execPath, [resolve(root, script), ...args], { cwd: root, env, shell: false, stdio: ["ignore", "ignore", "pipe"], encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${script} failed during isolated E2E setup.`);
}

checked("node_modules/prisma/build/index.js", ["migrate", "deploy", "--schema", "prisma/schema.prisma"]);
checked("node_modules/tsx/dist/cli.mjs", ["prisma/seed.ts"]);
const child = spawn(process.execPath, [resolve(root, "node_modules/next/dist/bin/next"), "dev", "--hostname", "127.0.0.1", "--port", port], { cwd: resolve(root, "apps/web"), env, shell: false, stdio: ["ignore", "ignore", "pipe"] });
child.stderr?.on("data", (chunk) => {
  const text = String(chunk);
  if (/error|failed|exception/i.test(text) && !/source map/i.test(text)) process.stderr.write("E2E server reported a startup/runtime error.\n");
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", (code) => process.exit(code ?? 1));
