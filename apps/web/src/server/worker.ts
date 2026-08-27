import { randomUUID } from "node:crypto";
import { db } from "@/server/db";
import { assertProductionRuntimeSecurity } from "@/server/auth/session";
import { drainDueOutbox } from "@/server/services/outbox";
import { processEmailOutbox } from "@/server/services/notifications";
import { structuredLog } from "@/server/observability";
import { assertCompiledBuildIdentity, compiledBuildId } from "@/server/build-identity";

const workerId = process.env.WORKER_ID || randomUUID(); const buildId = compiledBuildId;
const intervalMs = Number(process.env.OUTBOX_POLL_INTERVAL_MS || 5_000); const shutdownMs = Number(process.env.WORKER_SHUTDOWN_TIMEOUT_MS || 45_000);
if (!Number.isSafeInteger(intervalMs) || intervalMs < 1_000 || intervalMs > 60_000) throw new Error("Invalid worker polling interval.");
if (!Number.isSafeInteger(shutdownMs) || shutdownMs < 30_000 || shutdownMs > 120_000) throw new Error("Worker shutdown timeout must exceed bounded provider and SMTP calls plus finalization.");
if (process.env.NODE_ENV === "production") { assertProductionRuntimeSecurity(); assertCompiledBuildIdentity(); if (process.env.OUTBOX_WORKER_MODE !== "dedicated") throw new Error("Production worker requires OUTBOX_WORKER_MODE=dedicated."); }

let stopping = false; let active: Promise<void> | null = null; const controller = new AbortController();let heartbeatChain=Promise.resolve();
async function assertWorkerDatabaseIdentity(){const identity=await db.$queryRawUnsafe<Array<{role:string;worker:boolean;app:boolean}>>("SELECT current_user AS role,pg_has_role(current_user,'tempocove_worker','member') AS worker,pg_has_role(current_user,'tempocove_app','member') AS app");if(identity[0]?.role!=="tempocove_worker_login"||identity[0].worker!==true||identity[0].app!==false)throw new Error("Production worker requires the exact restricted worker database login.");}
async function heartbeat(status: string) { heartbeatChain=heartbeatChain.then(async()=>{await db.workerHeartbeat.upsert({ where: { workerId }, update: { lastSeenAt: new Date(), status, buildId }, create: { workerId, lastSeenAt: new Date(), status, buildId } });});await heartbeatChain; }
async function tick() {
  if (stopping || active) return;
  active = (async () => {
    const started = Date.now(); await heartbeat("RUNNING");
    const integration = await drainDueOutbox(new Date(), controller.signal); if (stopping) return;
    const email = await processEmailOutbox(undefined, new Date(), undefined, controller.signal);
    const [integrationDead, emailDead] = await Promise.all([db.integrationOutbox.count({ where: { status: "DEAD" } }), db.emailOutbox.count({ where: { status: "DEAD" } })]);
    structuredLog(integrationDead || emailDead ? "warn" : "info", { event: "worker_tick", workerId, attempted: integration.owners + email.attempted, pending: email.pending, dead: integrationDead + emailDead, durationMs: Date.now() - started });
    if(!stopping)await heartbeat("IDLE");
  })().catch(async () => { structuredLog("error", { event: "worker_tick_failed", workerId, code: "WORKER_TICK_FAILED" }); await heartbeat("DEGRADED").catch(() => undefined); }).finally(() => { active = null; });
  await active;
}
async function shutdown(signal: string) {
  if (stopping) return; stopping = true; controller.abort(); structuredLog("info", { event: "worker_shutdown", workerId, status: signal }); clearInterval(timer); clearInterval(heartbeatTimer);
  let drained = false; await Promise.race([(async()=>{await(active||Promise.resolve());await heartbeatChain;drained=true})(), new Promise((resolve) => setTimeout(resolve, shutdownMs))]);
  await heartbeat(drained ? "STOPPED" : "DEGRADED").catch(() => undefined); await db.$disconnect(); process.exit(drained ? 0 : 1);
}
process.once("SIGTERM", () => { void shutdown("SIGTERM"); }); process.once("SIGINT", () => { void shutdown("SIGINT"); });
if(process.env.NODE_ENV==="production")await assertWorkerDatabaseIdentity();await heartbeat("STARTING"); const timer = setInterval(() => { void tick(); }, intervalMs); const heartbeatTimer = setInterval(() => { if (!stopping) void heartbeat(active ? "RUNNING" : "IDLE").catch(() => undefined); }, Math.min(10_000, Math.max(2_000, Math.floor(intervalMs / 2)))); await tick();
structuredLog("info", { event: "worker_started", workerId, status: "RUNNING" });
