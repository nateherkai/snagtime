import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { DateTime } from "luxon";
import nodemailer from "nodemailer";
import { db } from "@/server/db";
import { decryptToken, encryptToken } from "@/server/crypto/tokens";
import { systemEmailIdentity, validatedMailbox } from "@/server/email-config";

export type EmailKind = "EMAIL_VERIFY" | "PASSWORD_RESET" | "WORKSPACE_INVITATION" | "BOOKING_RECOVERY" | "BOOKING_CONFIRMED" | "BOOKING_RESCHEDULED" | "BOOKING_CANCELLED";
export type EmailDelivery = { workspaceId: string; outboxId: string; idempotencyKey: string; recipientEmail: string; subject: string; text: string; replyTo?: string };
export interface EmailProvider { send(message: EmailDelivery, signal?: AbortSignal): Promise<void> }
export const EMAIL_LEASE_MS = 60_000;
const MAX_ATTEMPTS = 8;

function tokenSecret() {
  const secret = process.env.EMAIL_TOKEN_SECRET;
  if (secret && Buffer.byteLength(secret) >= 32) return secret;
  if (process.env.NODE_ENV === "test") return "tempocove-test-only-email-token-secret-2026";
  if (process.env.DEMO_MODE === "true" && process.env.NODE_ENV !== "production") return "tempocove-explicit-demo-email-token-secret-2026";
  throw new Error("EMAIL_TOKEN_SECRET with at least 32 bytes is required outside explicit demo mode.");
}

function mac(value: string) { return createHmac("sha256", tokenSecret()).update(value).digest("base64url"); }
export function createActionToken(purpose: string, binding: string, id = randomBytes(18).toString("base64url")) {
  const signature = mac(`token:v1\0${purpose}\0${id}\0${binding}`); const token = `v1.${id}.${signature}`;
  return { id, token, tokenHash: `hmac:v1:${mac(`digest:v1\0${purpose}\0${token}\0${binding}`)}` };
}
export function materializeActionToken(id: string, purpose: string, binding: string) { return createActionToken(purpose, binding, id).token; }
export function actionTokenHash(token: string, purpose: string, binding: string) { return `hmac:v1:${mac(`digest:v1\0${purpose}\0${token}\0${binding}`)}`; }
export function actionTokenId(token: string) {
  if (token.length > 500) return null; const [version, id, supplied] = token.split(".");
  return version === "v1" && id && supplied ? id : null;
}
export function tokenHashMatches(supplied: string, expected: string) {
  const left = Buffer.from(supplied); const right = Buffer.from(expected); return left.length === right.length && timingSafeEqual(left, right);
}

export function accountTokenBinding(workspaceId: string, userId: string, email: string) { return `${workspaceId}\0${userId}\0${email}`; }
export function bookingTokenBinding(workspaceId: string, bookingId: string, email: string) { return `${workspaceId}\0${bookingId}\0${email}`; }
export function invitationTokenBinding(workspaceId: string, email: string, role: string, version: number) { return `${workspaceId}\0${email}\0${role}\0${version}`; }

type Transaction = Prisma.TransactionClient;
type EnqueueEmail = { workspaceId: string; bookingId?: string; kind: EmailKind; recipientEmail: string; subject: string; payload: Record<string, unknown>; idempotencyKey: string; bookingMutationVersion?: number };
export async function enqueueEmail(tx: Transaction, input: EnqueueEmail) {
  return tx.emailOutbox.upsert({ where: { idempotencyKey: input.idempotencyKey }, update: {}, create: {
    workspaceId: input.workspaceId, bookingId: input.bookingId, kind: input.kind, recipientEmail: input.recipientEmail.toLowerCase(),
    subjectSnapshot: input.subject, payloadJson: JSON.stringify(input.payload), idempotencyKey: input.idempotencyKey,
    bookingMutationVersion: input.bookingMutationVersion,
  } });
}

type BookingEmailSnapshot = { id: string; workspaceId: string; hostId: string; inviteeName: string; inviteeEmail: string; inviteeTimeZone: string; eventTitleSnapshot: string; startAt: Date; endAt: Date; priceCents: number; currency: string; stripePaymentStatus: string | null; refundStatus?: string; mutationVersion: number };
function paymentTruth(booking: BookingEmailSnapshot) {
  if (booking.priceCents === 0) return "No payment required";
  if (booking.refundStatus === "REFUNDED") return "Refunded";
  if (booking.refundStatus === "REFUND_PENDING") return "Paid; refund pending";
  if (booking.refundStatus === "REFUND_FAILED") return "Paid; refund needs attention";
  return booking.stripePaymentStatus === "paid" ? "Paid" : booking.stripePaymentStatus === "paid_after_cancel" ? "Paid; refund pending" : "Payment pending";
}
export async function enqueueBookingEmail(tx: Transaction, booking: BookingEmailSnapshot, kind: "BOOKING_CONFIRMED" | "BOOKING_RESCHEDULED" | "BOOKING_CANCELLED", now = new Date()) {
  await tx.bookingRecoveryToken.updateMany({ where: { bookingId: booking.id, consumedAt: null, revokedAt: null }, data: { revokedAt: now } });
  const expiresAt = new Date(Math.max(now.getTime() + 7 * 24 * 60 * 60_000, booking.endAt.getTime() + 30 * 24 * 60 * 60_000));
  const id = randomBytes(18).toString("base64url"); const binding = bookingTokenBinding(booking.workspaceId, booking.id, booking.inviteeEmail.toLowerCase());
  const authority = createActionToken("BOOKING_RECOVERY", binding, id);
  await tx.bookingRecoveryToken.create({ data: { id, workspaceId: booking.workspaceId, bookingId: booking.id, email: booking.inviteeEmail.toLowerCase(), tokenHash: authority.tokenHash, expiresAt } });
  const action = kind === "BOOKING_CANCELLED" ? "cancelled" : kind === "BOOKING_RESCHEDULED" ? "rescheduled" : "confirmed";
  await enqueueEmail(tx, { workspaceId: booking.workspaceId, bookingId: booking.id, kind, recipientEmail: booking.inviteeEmail, subject: `${booking.eventTitleSnapshot} ${action}`,
    payload: { recoveryTokenId: id, eventTitle: booking.eventTitleSnapshot, startAt: booking.startAt.toISOString(), timeZone: booking.inviteeTimeZone, priceCents: booking.priceCents, currency: booking.currency, paymentTruth: paymentTruth(booking) },
    idempotencyKey: `email:booking:${kind}:${booking.id}:${booking.mutationVersion}`, bookingMutationVersion: booking.mutationVersion });
  const host = await tx.user.findUnique({ where: { id: booking.hostId }, select: { email: true, timeZone: true } });
  if (host) {
    const organizerAction = kind === "BOOKING_CANCELLED" ? "Booking canceled" : kind === "BOOKING_RESCHEDULED" ? "Booking rescheduled" : "New booking";
    await enqueueEmail(tx, { workspaceId: booking.workspaceId, bookingId: booking.id, kind, recipientEmail: host.email, subject: `${organizerAction}: ${booking.eventTitleSnapshot}`,
      payload: { audience: "organizer", hostId: booking.hostId, inviteeName: booking.inviteeName, inviteeEmail: booking.inviteeEmail, eventTitle: booking.eventTitleSnapshot, startAt: booking.startAt.toISOString(), timeZone: host.timeZone, priceCents: booking.priceCents, currency: booking.currency, paymentTruth: paymentTruth(booking) },
      idempotencyKey: `email:booking:organizer:${kind}:${booking.id}:${booking.mutationVersion}`, bookingMutationVersion: booking.mutationVersion });
  }
}

function appBaseUrl() {
  const value = process.env.NEXT_PUBLIC_APP_URL || (process.env.NODE_ENV !== "production" ? "http://localhost:3000" : "");
  const url = new URL(value); if (process.env.NODE_ENV === "production" && url.protocol !== "https:") throw new Error("Production email links require canonical HTTPS NEXT_PUBLIC_APP_URL.");
  return url.origin;
}
function money(cents: number, currency: string) { return cents === 0 ? "Free" : new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100); }
function bookingTime(startAt: string, timeZone: string) { return DateTime.fromISO(startAt).setZone(timeZone).toLocaleString(DateTime.DATETIME_FULL); }

async function render(row: { kind: string; workspaceId: string; bookingId: string | null; recipientEmail: string; subjectSnapshot: string; payloadJson: string }, at = new Date()) {
  const payload = JSON.parse(row.payloadJson) as Record<string, unknown>; const base = appBaseUrl();
  if (row.kind === "EMAIL_VERIFY" || row.kind === "PASSWORD_RESET") {
    const record = await db.accountActionToken.findUnique({ where: { id: String(payload.tokenId) } });
    if (!record || record.workspaceId !== row.workspaceId || record.email !== row.recipientEmail || record.consumedAt || record.revokedAt || record.expiresAt <= at) return null;
    const binding = accountTokenBinding(record.workspaceId, record.userId, record.email); const token = materializeActionToken(record.id, record.purpose, binding);
    if (!tokenHashMatches(actionTokenHash(token, record.purpose, binding), record.tokenHash)) return null;
    const path = row.kind === "EMAIL_VERIFY" ? "/verify-email" : "/reset-password";
    return { subject: row.subjectSnapshot, text: `${row.kind === "EMAIL_VERIFY" ? "Verify your SnagTime email" : "Reset your SnagTime password"}: ${base}${path}#token=${encodeURIComponent(token)}` };
  }
  if (row.kind === "WORKSPACE_INVITATION") {
    const invitation = await db.workspaceInvitation.findUnique({ where: { id: String(payload.invitationId) } });
    if (!invitation || invitation.workspaceId !== row.workspaceId || invitation.email !== row.recipientEmail || invitation.status !== "PENDING" || invitation.expiresAt <= at || invitation.tokenVersion !== Number(payload.tokenVersion) || !invitation.tokenHash) return null;
    const binding = invitationTokenBinding(invitation.workspaceId, invitation.email, invitation.role, invitation.tokenVersion); const token = materializeActionToken(invitation.id, "WORKSPACE_INVITATION", binding);
    if (!tokenHashMatches(actionTokenHash(token, "WORKSPACE_INVITATION", binding), invitation.tokenHash)) return null;
    return { subject: row.subjectSnapshot, text: `You were invited to ${String(payload.workspaceName)} as ${invitation.role}. Accept: ${base}/invite/accept#token=${encodeURIComponent(token)}` };
  }
  if (payload.audience === "organizer") {
    if (!row.bookingId) return null;
    const booking = await db.booking.findFirst({ where: { id: row.bookingId, workspaceId: row.workspaceId, hostId: String(payload.hostId) }, select: { host: { select: { email: true } } } });
    if (!booking || booking.host.email.toLowerCase() !== row.recipientEmail.toLowerCase()) return null;
    const action = row.kind === "BOOKING_CANCELLED" ? "canceled" : row.kind === "BOOKING_RESCHEDULED" ? "rescheduled" : "confirmed";
    return { subject: row.subjectSnapshot, text: `${String(payload.inviteeName)} (${String(payload.inviteeEmail)}) ${action} ${String(payload.eventTitle)}. ${bookingTime(String(payload.startAt), String(payload.timeZone))}. ${money(Number(payload.priceCents), String(payload.currency))}. Payment: ${String(payload.paymentTruth)}. View booking: ${base}/bookings?selected=${encodeURIComponent(row.bookingId)}`, replyTo: String(payload.inviteeEmail) };
  }
  const recovery = await db.bookingRecoveryToken.findUnique({ where: { id: String(payload.recoveryTokenId) } });
  if (!recovery || recovery.workspaceId !== row.workspaceId || recovery.bookingId !== row.bookingId || recovery.email !== row.recipientEmail || recovery.consumedAt || recovery.revokedAt || recovery.expiresAt <= at) return null;
  const binding = bookingTokenBinding(recovery.workspaceId, recovery.bookingId, recovery.email); const token = materializeActionToken(recovery.id, "BOOKING_RECOVERY", binding);
  if (!tokenHashMatches(actionTokenHash(token, "BOOKING_RECOVERY", binding), recovery.tokenHash)) return null;
  if (row.kind === "BOOKING_RECOVERY") return { subject: row.subjectSnapshot, text: `Manage your booking: ${base}/manage/${recovery.bookingId}/reschedule#recovery=${encodeURIComponent(token)}` };
  const action = row.kind === "BOOKING_CANCELLED" ? "cancelled" : row.kind === "BOOKING_RESCHEDULED" ? "rescheduled" : "confirmed";
  return { subject: row.subjectSnapshot, text: `${String(payload.eventTitle)} is ${action}. ${bookingTime(String(payload.startAt), String(payload.timeZone))}. ${money(Number(payload.priceCents), String(payload.currency))}. Payment: ${String(payload.paymentTruth)}. Manage: ${base}/manage/${recovery.bookingId}/reschedule#recovery=${encodeURIComponent(token)}` };
}

export class LocalInboxEmailProvider implements EmailProvider {
  async send(message: EmailDelivery) {
    if (process.env.NODE_ENV === "production" || process.env.DEMO_MODE !== "true" || process.env.EMAIL_PROVIDER !== "local") throw new Error("LOCAL_EMAIL_PROVIDER_DISABLED");
    const encryptedText = encryptToken(message.text); if (!encryptedText) throw new Error("LOCAL_EMAIL_ENCRYPTION_REQUIRED");
    await db.localInboxMessage.upsert({ where: { outboxId: message.outboxId }, update: {}, create: { workspaceId: message.workspaceId, outboxId: message.outboxId, recipientEmail: message.recipientEmail, subject: message.subject, encryptedText } });
  }
}
export class SmtpEmailProvider implements EmailProvider {
  private readonly transport: ReturnType<typeof nodemailer.createTransport>;
  private readonly from: string;
  private readonly systemReplyTo: string;
  constructor() {
    const required = ["SMTP_HOST","SMTP_PORT","SMTP_USER","SMTP_PASSWORD","EMAIL_FROM","EMAIL_REPLY_TO","EMAIL_SENDER_DOMAIN","SMTP_TLS_MODE"];
    if (required.some((name) => !process.env[name])) throw new Error("SMTP_CONFIGURATION_INCOMPLETE");
    const port = Number(process.env.SMTP_PORT); const timeout = Number(process.env.SMTP_TIMEOUT_MS || 8_000);
    if (!Number.isSafeInteger(port) || port < 1 || port > 65_535 || !Number.isSafeInteger(timeout) || timeout < 1_000 || timeout > 10_000) throw new Error("SMTP_CONFIGURATION_INVALID");
    const mode = process.env.SMTP_TLS_MODE; if (mode !== "implicit" && mode !== "starttls") throw new Error("SMTP_CONFIGURATION_INVALID");
    const allowSelfSigned = process.env.NODE_ENV === "test" && process.env.SMTP_ALLOW_SELF_SIGNED === "true";
    const identity = systemEmailIdentity(); this.systemReplyTo = identity.replyTo; this.from = identity.from;
    this.transport = nodemailer.createTransport({ host: process.env.SMTP_HOST!, port, secure: mode === "implicit", requireTLS: mode === "starttls", auth: { user: process.env.SMTP_USER!, pass: process.env.SMTP_PASSWORD! }, connectionTimeout: timeout, greetingTimeout: timeout, socketTimeout: timeout, tls: { rejectUnauthorized: !allowSelfSigned } });
  }
  async send(message: EmailDelivery, signal?: AbortSignal) {
    if (signal?.aborted) throw new Error("SMTP_DELIVERY_ABORTED");
    const identity = createHash("sha256").update(`tempocove-email-v1\0${message.idempotencyKey}`).digest("hex");
    await this.transport.sendMail({ from: this.from, to: validatedMailbox(message.recipientEmail), replyTo: validatedMailbox(message.replyTo || this.systemReplyTo), subject: message.subject, text: message.text, messageId: `<${identity}@snagtime.invalid>`, headers: { "X-SnagTime-Dedupe": identity } });
    // Once SMTP acknowledges the deterministic message id, commit SENT even if shutdown starts.
    // Retrying after an accepted response would create a duplicate external delivery.
  }
}
export function getEmailProvider(): EmailProvider { return process.env.EMAIL_PROVIDER === "smtp" ? new SmtpEmailProvider() : new LocalInboxEmailProvider(); }

async function tokenStillCurrent(row: { kind: string; workspaceId: string; bookingId: string | null; recipientEmail: string; payloadJson: string }, at: Date) { return Boolean(await render({ ...row, subjectSnapshot: "" }, at)); }
export async function processEmailOutbox(workspaceId?: string, now = new Date(), provider: EmailProvider = getEmailProvider(), signal?: AbortSignal) {
  const due = await db.emailOutbox.findMany({ where: { workspaceId, OR: [{ status: { in: ["PENDING","RETRY"] }, nextAttemptAt: { lte: now } }, { status: "PROCESSING", leaseExpiresAt: { lte: now } }] }, orderBy: { createdAt: "asc" }, take: 50 });
  let attempted = 0;
  for (const candidate of due) {
    if (signal?.aborted) break;
    const leaseToken = randomBytes(18).toString("base64url");
    const claimed = await db.emailOutbox.updateMany({ where: { id: candidate.id, OR: [{ status: { in: ["PENDING","RETRY"] }, nextAttemptAt: { lte: now } }, { status: "PROCESSING", leaseExpiresAt: { lte: now } }] }, data: { status: "PROCESSING", leaseToken, leaseExpiresAt: new Date(now.getTime() + EMAIL_LEASE_MS), attemptCount: { increment: 1 } } });
    if (claimed.count !== 1) continue; attempted += 1;
    if (signal?.aborted) { await db.emailOutbox.updateMany({ where: { id: candidate.id, leaseToken, status: "PROCESSING" }, data: { status: "RETRY", attemptCount: { decrement: 1 }, nextAttemptAt: now, leaseToken: null, leaseExpiresAt: null, lastErrorCode: "WORKER_STOPPED" } }); break; }
    const row = await db.emailOutbox.findFirstOrThrow({ where: { id: candidate.id, leaseToken, status: "PROCESSING" } });
    try {
      if (row.bookingId && row.bookingMutationVersion != null) {
        const booking = await db.booking.findFirst({ where: { id: row.bookingId, workspaceId: row.workspaceId }, select: { mutationVersion: true } });
        if (!booking || booking.mutationVersion !== row.bookingMutationVersion) { await db.emailOutbox.updateMany({ where: { id: row.id, leaseToken, status: "PROCESSING" }, data: { status: "SUPERSEDED", leaseToken: null, leaseExpiresAt: null, completedAt: now, lastErrorCode: "STALE_BOOKING_VERSION" } }); continue; }
      }
      if (!await tokenStillCurrent(row, now)) { await db.emailOutbox.updateMany({ where: { id: row.id, leaseToken, status: "PROCESSING" }, data: { status: "SUPERSEDED", leaseToken: null, leaseExpiresAt: null, completedAt: now, lastErrorCode: "AUTHORITY_NOT_CURRENT" } }); continue; }
      const rendered = await render(row, now); if (!rendered) throw new Error("EMAIL_AUTHORITY_NOT_CURRENT");
      if (signal?.aborted) throw new Error("EMAIL_WORKER_STOPPING");
      const replyTo = rendered.replyTo || (process.env.EMAIL_REPLY_TO ? validatedMailbox(process.env.EMAIL_REPLY_TO) : undefined);
      await provider.send({ workspaceId: row.workspaceId, outboxId: row.id, idempotencyKey: row.idempotencyKey, recipientEmail: row.recipientEmail, ...rendered, replyTo }, signal);
      await db.emailOutbox.updateMany({ where: { id: row.id, leaseToken, status: "PROCESSING" }, data: { status: "COMPLETED", completedAt: now, leaseToken: null, leaseExpiresAt: null, lastErrorCode: null } });
    } catch {
      if (signal?.aborted) await db.emailOutbox.updateMany({ where: { id: row.id, leaseToken, status: "PROCESSING" }, data: { status: "RETRY", attemptCount: { decrement: 1 }, nextAttemptAt: now, leaseToken: null, leaseExpiresAt: null, lastErrorCode: "WORKER_STOPPED" } });
      else { const attempt = row.attemptCount; await db.emailOutbox.updateMany({ where: { id: row.id, leaseToken, status: "PROCESSING" }, data: { status: attempt >= MAX_ATTEMPTS ? "DEAD" : "RETRY", nextAttemptAt: new Date(now.getTime() + Math.min(60 * 60_000, 2 ** Math.min(attempt, 10) * 1_000)), leaseToken: null, leaseExpiresAt: null, lastErrorCode: "DELIVERY_FAILED" } }); }
    }
  }
  return { attempted, pending: await db.emailOutbox.count({ where: { workspaceId, status: { in: ["PENDING","RETRY","PROCESSING"] } } }) };
}

export async function listLocalInbox(workspaceId: string) {
  if (process.env.NODE_ENV === "production" || process.env.DEMO_MODE !== "true" || process.env.EMAIL_PROVIDER !== "local") throw new Error("LOCAL_INBOX_DISABLED");
  const rows = await db.localInboxMessage.findMany({ where: { workspaceId }, orderBy: { createdAt: "desc" }, take: 100 });
  return rows.map((row) => ({ id: row.id, recipientEmail: row.recipientEmail, subject: row.subject, text: decryptToken(row.encryptedText) || "", createdAt: row.createdAt.toISOString() }));
}
