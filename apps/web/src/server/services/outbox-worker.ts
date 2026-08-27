import { drainDueOutbox } from "@/server/services/outbox";
import { processEmailOutbox } from "@/server/services/notifications";

const WORKER = Symbol.for("tempocove.outbox.worker");
type WorkerState = { timer: NodeJS.Timeout; running: boolean };
const shared = globalThis as typeof globalThis & { [WORKER]?: WorkerState };

export function startLocalOutboxWorker(intervalMs = Number(process.env.OUTBOX_POLL_INTERVAL_MS || 5_000)) {
  if (shared[WORKER] || process.env.OUTBOX_WORKER_ENABLED === "false") return;
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 1_000 || intervalMs > 60_000) throw new Error("OUTBOX_POLL_INTERVAL_MS must be between 1000 and 60000.");
  const state: WorkerState = { running: false, timer: undefined as unknown as NodeJS.Timeout };
  const tick = async () => {
    if (state.running) return; state.running = true;
    try { await drainDueOutbox(); } catch { /* Calendar/payment rows retain durable retry state. */ }
    try { await processEmailOutbox(); } catch { /* Email rows retain durable retry state. */ }
    finally { state.running = false; }
  };
  state.timer = setInterval(() => { void tick(); }, intervalMs); state.timer.unref(); shared[WORKER] = state; void tick();
}

export function stopLocalOutboxWorkerForTest() { const state = shared[WORKER]; if (state) clearInterval(state.timer); delete shared[WORKER]; }
