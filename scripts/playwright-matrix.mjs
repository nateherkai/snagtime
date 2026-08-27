import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { resolve } from "node:path";

const projects = ["chromium-desktop", "edge-desktop", "chromium-mobile", "edge-mobile"];
const forwarded = process.argv.slice(2);

async function findAvailablePort() {
  return await new Promise((resolvePort, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolvePort(port));
    });
  });
}

for (const project of projects) {
  const port = await findAvailablePort();
  const status = await new Promise((resolveStatus, reject) => {
    const child = spawn(process.execPath, [resolve("node_modules", "@playwright", "test", "cli.js"), "test", "--project", project, ...forwarded], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PLAYWRIGHT_PORT: String(port),
        PLAYWRIGHT_DATABASE_PATH: resolve("runtime", "playwright", `e2e-${project}.db`),
      },
      stdio: "inherit",
      shell: false,
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => resolveStatus(signal ? 1 : code ?? 1));
  });
  if (status !== 0) process.exit(status);
}
