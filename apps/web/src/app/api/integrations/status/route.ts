import { requireWorkspaceAccess } from "@/server/auth/session";
import { apiError, ok } from "@/server/http";
import { googleCalendarStatus } from "@/server/services/calendar";
import { stripeTestConfigurationReady } from "@/server/stripe-credentials";

export async function GET(request: Request) {
  try {
    const access = await requireWorkspaceAccess(request);
    return ok({
      google: await googleCalendarStatus(access.user.id, access.workspaceId),
      stripe: { configured: stripeTestConfigurationReady(), mode: "test" as const },
      outboxWorker: { enabled: process.env.OUTBOX_WORKER_ENABLED !== "false", activation: "next-node-instrumentation" as const, productionScheduler: "deferred" as const },
    });
  } catch (error) { return apiError(error); }
}
