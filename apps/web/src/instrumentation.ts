export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NODE_ENV === "test") return;
  if (process.env.NEXT_PHASE !== "phase-production-build") {
    const { assertProductionRuntimeSecurity } = await import("@/server/auth/session");
    assertProductionRuntimeSecurity();
  }
  if (process.env.NODE_ENV === "production" && process.env.NEXT_PHASE !== "phase-production-build") {
    const { assertCompiledBuildIdentity } = await import("@/server/build-identity"); assertCompiledBuildIdentity();
    if (process.env.OUTBOX_WORKER_MODE !== "dedicated") throw new Error("Production web requires a dedicated outbox worker.");
  } else {
    const { startLocalOutboxWorker } = await import("@/server/services/outbox-worker"); startLocalOutboxWorker();
  }
}
