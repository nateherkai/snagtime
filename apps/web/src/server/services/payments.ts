import { createHash } from "node:crypto";
import { Prisma, type Booking, type EventType } from "@prisma/client";
import Stripe from "stripe";
import { enqueueBookingEmail } from "@/server/services/notifications";
import { db } from "@/server/db";
import { AppError } from "@/server/errors";
import { enterProviderDatabaseContext } from "@/server/db-context";
import { stripeCredentialSetReady, stripeTestConfigurationReady } from "@/server/stripe-credentials";
import { shouldDrainOutboxInline } from "@/server/services/outbox-dispatch";

export type CheckoutResult = { sessionId: string; url: string | null };
export type RefundResult = { refundId: string; status: "succeeded" | "pending" | "failed"; failureCode: string | null };
export interface PaymentService {
  createCheckout(booking: Booking, eventType: EventType): Promise<CheckoutResult | null>;
  expireCheckout(sessionId: string): Promise<void>;
  refundPayment(booking: Booking): Promise<RefundResult>;
}

export class StubPaymentService implements PaymentService {
  async createCheckout(booking?: Booking) {
    if (booking?.priceCents && booking.priceCents > 0) throw new AppError("PAYMENTS_NOT_CONFIGURED", "Payments are not configured for this event type.", 503);
    return null;
  }
  async expireCheckout() {}
  async refundPayment(): Promise<RefundResult> { throw new AppError("PAYMENTS_NOT_CONFIGURED", "Payments are not configured for this refund.", 503); }
}

export function assertPaidBookingsConfigured() {
  if (!stripeTestConfigurationReady()) {
    throw new AppError("PAYMENTS_NOT_CONFIGURED", "Stripe test mode must be configured before publishing a paid event type.", 503);
  }
}

export class StripeTestPaymentService implements PaymentService {
  private readonly stripe: Stripe;
  constructor(secretKey = process.env.STRIPE_SECRET_KEY, stripeClient?: Stripe) {
    if (!stripeCredentialSetReady(secretKey, false)) throw new Error("SnagTime only accepts a complete authorized Stripe test-mode credential set.");
    this.stripe = stripeClient ?? new Stripe(secretKey!);
  }

  async createCheckout(booking: Booking, eventType: EventType) {
    if (!booking.priceCents) return null;
    if (!booking.checkoutResumeExpiresAt || booking.checkoutResumeExpiresAt.getTime() - Date.now() < 30 * 60_000) throw new Error("CHECKOUT_RESUME_EXPIRED");
    const urls = stripeCheckoutReturnUrls(booking, eventType);
    const session = await this.stripe.checkout.sessions.create({
      mode: "payment", payment_method_types: ["card"], wallet_options: { link: { display: "never" } }, customer_email: booking.inviteeEmail, client_reference_id: booking.id,
      success_url: urls.successUrl,
      cancel_url: urls.cancelUrl,
      metadata: { bookingId: booking.id, eventTypeId: eventType.id, durationId: booking.durationId ?? "" },
      // Stripe requires this timestamp to be strictly less than 24 hours from
      // provider receipt. Leave a bounded margin for transport and clock skew.
      expires_at: Math.floor(Math.min(booking.checkoutResumeExpiresAt.getTime(), Date.now() + (23 * 60 + 55) * 60_000) / 1000),
      line_items: [{ quantity: 1, price_data: { currency: booking.currency, unit_amount: booking.priceCents, product_data: { name: `${eventType.name} (${booking.durationMinutes} min)` } } }],
    }, { idempotencyKey: `booking:${booking.id}:checkout:v2` });
    if (session.livemode) throw new Error("Stripe returned a live-mode Checkout Session.");
    return { sessionId: session.id, url: session.url };
  }

  async expireCheckout(sessionId: string) {
    const session = await this.stripe.checkout.sessions.retrieve(sessionId);
    if (session.livemode) throw new Error("Refusing to mutate a live-mode Checkout Session.");
    if (session.status === "open") await this.stripe.checkout.sessions.expire(sessionId);
  }

  async refundPayment(booking: Booking): Promise<RefundResult> {
    if (!booking.stripePaymentIntentId || booking.priceCents <= 0) throw new Error("STRIPE_REFUND_AUTHORITY_REQUIRED");
    const intent = await this.stripe.paymentIntents.retrieve(booking.stripePaymentIntentId);
    if (intent.livemode || intent.id !== booking.stripePaymentIntentId || intent.amount_received !== booking.priceCents || intent.currency.toLowerCase() !== booking.currency.toLowerCase()) {
      throw new Error("STRIPE_REFUND_AUTHORITY_MISMATCH");
    }
    const refund = await this.stripe.refunds.create({
      payment_intent: booking.stripePaymentIntentId,
      amount: booking.priceCents,
      reason: "requested_by_customer",
      metadata: { bookingId: booking.id, workspaceId: booking.workspaceId },
    }, { idempotencyKey: `booking:${booking.id}:refund:full:v1` });
    const status = refund.status === "succeeded" ? "succeeded" : refund.status === "failed" || refund.status === "canceled" ? "failed" : "pending";
    return { refundId: refund.id, status, failureCode: refund.failure_reason ?? null };
  }
}

export function stripeCheckoutReturnUrls(booking: Pick<Booking, "id">, eventType: Pick<EventType, "slug">) {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  return {
    successUrl: `${baseUrl}/book/${encodeURIComponent(eventType.slug)}/confirmation?booking=${encodeURIComponent(booking.id)}&payment=success`,
    cancelUrl: `${baseUrl}/manage/${encodeURIComponent(booking.id)}/cancel?slug=${encodeURIComponent(eventType.slug)}&payment=cancelled`,
  };
}

export function getPaymentService(): PaymentService {
  return process.env.PAYMENTS_PROVIDER === "stripe" ? new StripeTestPaymentService() : new StubPaymentService();
}

function providerId(value: string | { id: string } | null | undefined) { return typeof value === "string" ? value : value?.id ?? null; }
function checkoutPaymentIntent(session: Stripe.Checkout.Session) { return providerId(session.payment_intent); }
function checkoutCharge(session: Stripe.Checkout.Session) {
  return typeof session.payment_intent === "object" && session.payment_intent && "latest_charge" in session.payment_intent
    ? providerId(session.payment_intent.latest_charge as string | { id: string } | null) : null;
}
async function resolveCheckoutAuthority(stripe: Stripe, session: Stripe.Checkout.Session) {
  const paymentIntentId = checkoutPaymentIntent(session);
  if (!paymentIntentId) throw new AppError("INVALID_STRIPE_PAYMENT", "Stripe payment authority is missing.", 400);
  const embeddedChargeId = checkoutCharge(session);
  if (embeddedChargeId) return { paymentIntentId, chargeId: embeddedChargeId };
  const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
  const chargeId = providerId(intent.latest_charge);
  if (intent.livemode || intent.id !== paymentIntentId || intent.status !== "succeeded" || intent.amount_received !== session.amount_total || intent.currency.toLowerCase() !== session.currency?.toLowerCase() || !chargeId) {
    throw new AppError("INVALID_STRIPE_PAYMENT", "Stripe payment authority does not match the Checkout Session.", 400);
  }
  return { paymentIntentId, chargeId };
}
const refundEventTypes = new Set(["refund.created", "refund.updated", "refund.failed"]);

export async function processStripeWebhook(rawBody: string, signature: string) {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripeCredentialSetReady(secretKey, true) || !webhookSecret) throw new Error("Stripe test webhook credentials are not configured.");
  const stripe = new Stripe(secretKey!);
  const event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  if (event.livemode) throw new AppError("LIVE_STRIPE_EVENT_REJECTED", "Live Stripe events are not accepted.", 400);
  const checkoutAuthority = event.type === "checkout.session.completed"
    ? await resolveCheckoutAuthority(stripe, event.data.object as Stripe.Checkout.Session)
    : null;
  const payloadHash = createHash("sha256").update(rawBody).digest("hex");
  const providerObject = event.data.object as Stripe.Checkout.Session | Stripe.Refund;
  const providerSubject = "client_reference_id" in providerObject
    ? providerObject.client_reference_id || event.id
    : providerObject.metadata?.bookingId || event.id;
  enterProviderDatabaseContext(`${providerSubject}|${event.id}`);
  let completedBookingId: string | null = null;
  try {
    await db.$transaction(async (tx) => {
      await tx.webhookEvent.create({ data: { id: event.id, provider: "stripe", eventType: event.type, payloadHash } });
      if (refundEventTypes.has(event.type)) {
        const refund = event.data.object as Stripe.Refund;
        const bookingId = refund.metadata?.bookingId;
        const paymentIntentId = providerId(refund.payment_intent);
        const booking = bookingId ? await tx.booking.findUnique({ where: { id: bookingId } }) : null;
        if (!booking || !paymentIntentId || booking.stripePaymentIntentId !== paymentIntentId || refund.amount !== booking.priceCents || refund.currency.toLowerCase() !== booking.currency.toLowerCase()) {
          throw new AppError("INVALID_STRIPE_REFUND", "Stripe refund binding is invalid.", 400);
        }
        const succeeded = refund.status === "succeeded";
        const failed = event.type === "refund.failed" || refund.status === "failed" || refund.status === "canceled";
        await tx.booking.update({ where: { id: booking.id }, data: {
          stripeRefundId: refund.id,
          refundStatus: succeeded ? "REFUNDED" : failed ? "REFUND_FAILED" : "REFUND_PENDING",
          refundedAmountCents: succeeded ? refund.amount : booking.refundedAmountCents,
          refundFailureCode: failed ? refund.failure_reason ?? "PROVIDER_REFUND_FAILED" : null,
        } });
        await tx.integrationOutbox.updateMany({ where: { bookingId: booking.id, kind: "STRIPE_REFUND", status: { in: ["PENDING", "RETRY", "PROCESSING"] } }, data: {
          status: succeeded ? "COMPLETED" : failed ? "DEAD" : "RETRY",
          lastErrorCode: succeeded ? null : failed ? "PROVIDER_REFUND_FAILED" : "PROVIDER_REFUND_PENDING",
          leaseToken: null, leaseExpiresAt: null,
        } });
        return;
      }
      if (event.type !== "checkout.session.completed" && event.type !== "checkout.session.expired") return;
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.livemode || !session.client_reference_id) throw new AppError("INVALID_STRIPE_SESSION", "Stripe session binding is invalid.", 400);
      const booking = await tx.booking.findUnique({ where: { id: session.client_reference_id } });
      if (!booking || booking.stripeCheckoutSessionId !== session.id ||
        session.metadata?.bookingId !== booking.id || session.metadata?.eventTypeId !== booking.eventTypeId ||
        (session.metadata?.durationId || null) !== booking.durationId || session.amount_total !== booking.priceCents || session.currency?.toLowerCase() !== booking.currency.toLowerCase()) {
        throw new AppError("INVALID_STRIPE_SESSION", "Stripe session binding is invalid.", 400);
      }
      if (event.type === "checkout.session.completed") {
        const paymentIntentId = checkoutAuthority?.paymentIntentId; const chargeId = checkoutAuthority?.chargeId;
        if (session.payment_status !== "paid" || session.status !== "complete" || session.mode !== "payment" || !paymentIntentId || !chargeId || (booking.stripePaymentIntentId && booking.stripePaymentIntentId !== paymentIntentId)) {
          throw new AppError("INVALID_STRIPE_PAYMENT", "Stripe payment details do not match the booking.", 400);
        }
        if (booking.status === "PENDING_PAYMENT") {
          await tx.booking.update({ where: { id: booking.id }, data: { stripePaymentStatus: "paid", stripePaymentIntentId: paymentIntentId, stripeChargeId: chargeId, refundStatus: "NOT_REQUIRED", status: "CONFIRMED", mutationVersion: { increment: 1 }, calendarSyncStatus: "PENDING" } });
          await tx.integrationOutbox.upsert({ where: { idempotencyKey: `calendar:create:${booking.id}:paid` }, update: {}, create: { workspaceId: booking.workspaceId, bookingId: booking.id, kind: "CALENDAR_CREATE", idempotencyKey: `calendar:create:${booking.id}:paid` } });
          await enqueueBookingEmail(tx, { ...booking, stripePaymentStatus: "paid", mutationVersion: booking.mutationVersion + 1 }, "BOOKING_CONFIRMED");
          completedBookingId = booking.id;
        } else if (booking.status === "CANCELLED") {
          await tx.booking.update({ where: { id: booking.id }, data: { stripePaymentStatus: "paid_after_cancel", stripePaymentIntentId: paymentIntentId, stripeChargeId: chargeId, refundStatus: booking.refundStatus === "REFUNDED" ? "REFUNDED" : "REFUND_PENDING", refundFailureCode: booking.refundStatus === "REFUNDED" ? booking.refundFailureCode : null } });
          await tx.integrationOutbox.upsert({ where: { idempotencyKey: `stripe:refund:${booking.id}:full:v1` }, update: {}, create: { workspaceId: booking.workspaceId, bookingId: booking.id, kind: "STRIPE_REFUND", idempotencyKey: `stripe:refund:${booking.id}:full:v1` } });
          completedBookingId = booking.id;
        } else if (booking.status !== "CONFIRMED") throw new AppError("STALE_STRIPE_PAYMENT", "Booking payment state changed.", 409);
      } else {
        if (session.status !== "expired" || session.payment_status !== "unpaid" || session.mode !== "payment") throw new AppError("INVALID_STRIPE_EXPIRY", "Stripe expiry details do not match an unpaid expired session.", 400);
        if (booking.status === "PENDING_PAYMENT") {
          await tx.booking.update({ where: { id: booking.id }, data: { stripePaymentStatus: "expired", status: "CANCELLED", mutationVersion: { increment: 1 }, cancellationReason: "CHECKOUT_EXPIRED" } });
          await tx.bookingOccupancy.deleteMany({ where: { bookingId: booking.id } });
          await enqueueBookingEmail(tx, { ...booking, stripePaymentStatus: "expired", mutationVersion: booking.mutationVersion + 1 }, "BOOKING_CANCELLED");
        } else if (booking.status === "CANCELLED") await tx.booking.updateMany({ where: { id: booking.id, stripePaymentIntentId: null, stripePaymentStatus: { not: "paid_after_cancel" } }, data: { stripePaymentStatus: "expired" } });
        else throw new AppError("STALE_STRIPE_EXPIRY", "A confirmed booking cannot be expired.", 409);
      }
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existing = await db.webhookEvent.findUnique({ where: { id: event.id } });
      if (!existing || existing.provider !== "stripe" || existing.payloadHash !== payloadHash) throw new AppError("WEBHOOK_ID_COLLISION", "Webhook event identity does not match the recorded payload.", 409);
      return { duplicate: true, eventId: event.id };
    }
    throw error;
  }
  if (completedBookingId && shouldDrainOutboxInline()) {
    const { processBookingOutbox } = await import("@/server/services/outbox");
    await processBookingOutbox(completedBookingId);
  }
  return { duplicate: false, eventId: event.id };
}
