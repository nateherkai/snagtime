import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runtimeDir = resolve(projectRoot, "runtime");
const stopRequested = process.argv.includes("--stop");
const portFlag = process.argv.indexOf("--port");
const port = portFlag >= 0 ? Number(process.argv[portFlag + 1]) : 3001;

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("--port must be an integer between 1 and 65535");
}

mkdirSync(runtimeDir, { recursive: true });

const pidFile = resolve(runtimeDir, `snagtime-dev-${port}.pid`);
const logFile = resolve(runtimeDir, `snagtime-dev-${port}.log`);

function readPid() {
  if (!existsSync(pidFile)) return null;
  const value = Number(readFileSync(pidFile, "utf8").trim());
  return Number.isInteger(value) && value > 0 ? value : null;
}

function isRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

if (stopRequested) {
  const pid = readPid();
  if (!pid || !isRunning(pid)) {
    rmSync(pidFile, { force: true });
    console.log(`No persistent SnagTime server is running on port ${port}.`);
    process.exit(0);
  }

  const result = spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
    stdio: "inherit",
    windowsHide: true,
  });
  rmSync(pidFile, { force: true });
  process.exit(result.status ?? 1);
}

const existingPid = readPid();
if (existingPid && isRunning(existingPid)) {
  console.log(`SnagTime is already supervised on port ${port} (PID ${existingPid}).`);
  process.exit(0);
}

rmSync(pidFile, { force: true });
writeFileSync(pidFile, `${process.pid}\n`, { encoding: "utf8", flag: "wx" });

const logDescriptor = openSync(logFile, "a");
let child = null;
let shuttingDown = false;

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  writeFileSync(logDescriptor, line);
}

function cleanup() {
  rmSync(pidFile, { force: true });
  closeSync(logDescriptor);
}

function stop() {
  if (shuttingDown) return;
  shuttingDown = true;
  if (child?.pid) {
    spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
  }
  cleanup();
  process.exit(0);
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, stop);
}

process.on("uncaughtException", (error) => {
  log(`Supervisor error: ${error.stack ?? error.message}`);
  cleanup();
  process.exit(1);
});

function launch() {
  if (shuttingDown) return;

  log(`Starting SnagTime on http://localhost:${port}`);
  const command = `npx.cmd --no-install dotenv -e .env.local -- npm.cmd run dev --workspace @snagtime/web -- --port ${port}`;
  child = spawn(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", command], {
    cwd: projectRoot,
    env: {
      ...process.env,
      NEXT_DIST_DIR: `.next-persistent-${port}`,
      NEXT_PUBLIC_APP_URL: `http://localhost:${port}`,
    },
    stdio: ["ignore", logDescriptor, logDescriptor],
    windowsHide: true,
  });

  child.once("exit", (code, signal) => {
    child = null;
    if (shuttingDown) return;
    log(`SnagTime exited (code ${code ?? "none"}, signal ${signal ?? "none"}); restarting in 2 seconds.`);
    setTimeout(launch, 2000);
  });
}

log(`Supervisor started with PID ${process.pid}.`);
launch();
