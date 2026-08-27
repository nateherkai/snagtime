import { AppError } from "@/server/errors";
import { apiError, ok, readBoundedText } from "@/server/http";
import { processStripeWebhook } from "@/server/services/payments";
import { clientAddress, enforceRateLimit } from "@/server/rate-limit";

export async function POST(request: Request) {
  try {
    await enforceRateLimit(`stripe-webhook:${clientAddress(request)}`, 120, 60_000);
    const signature = request.headers.get("stripe-signature");
    if (!signature) throw new AppError("MISSING_SIGNATURE", "Stripe signature is required.", 400);
    const raw = await readBoundedText(request, 1024 * 1024);
    return ok(await processStripeWebhook(raw, signature));
  } catch (error) { return apiError(error); }
}
