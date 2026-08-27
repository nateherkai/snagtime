import { apiError, ok } from "@/server/http";
import { mapEventType } from "@/server/mappers";
import { getEventTypeBySlug } from "@/server/services/event-types";
import { clientAddress, enforceRateLimit } from "@/server/rate-limit";

type Context = { params: Promise<{ slug: string }> };
export async function GET(request: Request, context: Context) {
  try { await enforceRateLimit(`public-event:ip:${clientAddress(request)}`,120,60_000); const { slug } = await context.params; return ok(mapEventType(await getEventTypeBySlug(slug))); } catch (error) { return apiError(error); }
}
