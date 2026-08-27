import { createHash, randomBytes } from "node:crypto";
import { db } from "@/server/db";
import { AppError } from "@/server/errors";
import { hashPassword } from "@/server/auth/password";
import { actionTokenHash, actionTokenId, bookingTokenBinding, createActionToken, tokenHashMatches } from "@/server/services/notifications";
import { enterCapabilityDatabaseContext } from "@/server/db-context";

const COMPARABLE_RECOVERY_PASSWORD = "Comparable!BookingRecovery9";
export type BookingRecoveryWorkPhase = "PASSWORD_KDF" | "BOOKING_LOOKUP" | "PREDECESSOR_REVOKE" | "TOKEN_INSERT" | "OUTBOX_INSERT";
const observeNothing: (phase: BookingRecoveryWorkPhase) => void = () => undefined;

export async function requestBookingManageLink(bookingId: string, emailInput: string, now = new Date(), observeWork: (phase: BookingRecoveryWorkPhase) => void = observeNothing) {
  const email = emailInput.trim().toLowerCase();
  enterCapabilityDatabaseContext(bookingId, undefined, undefined, "booking_recovery_request");
  await hashPassword(COMPARABLE_RECOVERY_PASSWORD); observeWork("PASSWORD_KDF");
  await db.$transaction(async (tx) => {
    const booking = await tx.booking.findUnique({ where: { id: bookingId }, select: { id: true, workspaceId: true, inviteeEmail: true, eventTitleSnapshot: true, endAt: true, status: true } }); observeWork("BOOKING_LOOKUP");
    const workspaceId = booking?.workspaceId ?? "ineligible-workspace"; const tokenId = randomBytes(18).toString("base64url");
    const expiresAt = new Date(Math.max(now.getTime() + 30 * 60_000, (booking?.endAt.getTime() ?? now.getTime()) + 30 * 24 * 60 * 60_000));
    const binding = bookingTokenBinding(workspaceId, bookingId, email); const authority = createActionToken("BOOKING_RECOVERY", binding, tokenId);
    await tx.$executeRaw`UPDATE "BookingRecoveryToken" SET "revokedAt"=${now}
      WHERE "bookingId"=${bookingId} AND lower("email")=${email} AND "consumedAt" IS NULL AND "revokedAt" IS NULL
      AND EXISTS (SELECT 1 FROM "Booking" b WHERE b."id"=${bookingId} AND b."workspaceId"=${workspaceId} AND lower(b."inviteeEmail")=${email} AND b."status" IN ('CONFIRMED','PENDING_PAYMENT'))`; observeWork("PREDECESSOR_REVOKE");
    await tx.$executeRaw`INSERT INTO "BookingRecoveryToken" ("id","workspaceId","bookingId","email","tokenHash","expiresAt","createdAt")
      SELECT ${tokenId},b."workspaceId",b."id",lower(b."inviteeEmail"),${authority.tokenHash},${expiresAt},${now} FROM "Booking" b
      WHERE b."id"=${bookingId} AND b."workspaceId"=${workspaceId} AND lower(b."inviteeEmail")=${email} AND b."status" IN ('CONFIRMED','PENDING_PAYMENT')`; observeWork("TOKEN_INSERT");
    const outboxId = randomBytes(18).toString("base64url"); const idempotencyKey = `email:booking-recovery:${tokenId}`; const payloadJson = JSON.stringify({ recoveryTokenId: tokenId }); const subject = `Manage ${booking?.eventTitleSnapshot || "your booking"}`;
    await tx.$executeRaw`INSERT INTO "EmailOutbox" ("id","workspaceId","bookingId","kind","recipientEmail","subjectSnapshot","payloadJson","idempotencyKey","nextAttemptAt","createdAt","updatedAt")
      SELECT ${outboxId},r."workspaceId",r."bookingId",'BOOKING_RECOVERY',r."email",${subject},${payloadJson},${idempotencyKey},${now},${now},${now}
      FROM "BookingRecoveryToken" r WHERE r."id"=${tokenId} AND r."tokenHash"=${authority.tokenHash}`; observeWork("OUTBOX_INSERT");
  });
  return { accepted: true as const };
}

function invalidRecovery() { return new AppError("INVALID_OR_EXPIRED_TOKEN", "This manage link is invalid or expired.", 400); }
export async function consumeBookingManageLink(token: string, now = new Date()) {
  const id = actionTokenId(token); if (!id) throw invalidRecovery(); let bookingId = ""; let sessionToken = ""; let expiresAt = now;
  enterCapabilityDatabaseContext(id, undefined, undefined, "booking_recovery_resolve");
  const authority = await db.bookingRecoveryToken.findUnique({ where: { id }, select: { bookingId: true } });
  if (!authority) throw invalidRecovery();
  enterCapabilityDatabaseContext(authority.bookingId, undefined, undefined, "booking_recovery_consume");
  await db.$transaction(async (tx) => {
    const record = await tx.bookingRecoveryToken.findUnique({ where: { id }, include: { booking: true } });
    if (!record || record.consumedAt || record.revokedAt || record.expiresAt <= now || record.booking.workspaceId !== record.workspaceId || record.booking.inviteeEmail.toLowerCase() !== record.email) throw invalidRecovery();
    const binding = bookingTokenBinding(record.workspaceId, record.bookingId, record.email);
    if (!tokenHashMatches(actionTokenHash(token, "BOOKING_RECOVERY", binding), record.tokenHash)) throw invalidRecovery();
    const consumed = await tx.bookingRecoveryToken.updateMany({ where: { id: record.id, tokenHash: record.tokenHash, consumedAt: null, revokedAt: null, expiresAt: { gt: now } }, data: { consumedAt: now } });
    if (consumed.count !== 1) throw invalidRecovery();
    await tx.bookingRecoveryToken.updateMany({ where: { bookingId: record.bookingId, id: { not: record.id }, consumedAt: null, revokedAt: null }, data: { revokedAt: now } });
    await tx.bookingManageSession.updateMany({ where: { bookingId: record.bookingId, revokedAt: null }, data: { revokedAt: now } });
    await tx.bookingCapability.updateMany({ where: { bookingId: record.bookingId, revokedAt: null }, data: { revokedAt: now } });
    const scopes = record.booking.status === "CONFIRMED" ? "read,cancel,reschedule" : record.booking.status === "PENDING_PAYMENT" ? "read,cancel" : "read";
    sessionToken = randomBytes(32).toString("base64url"); expiresAt = record.expiresAt; bookingId = record.bookingId;
    await tx.booking.update({ where: { id: bookingId }, data: { manageExpiresAt: expiresAt } });
    await tx.bookingManageSession.create({ data: { bookingId, tokenHash: createHash("sha256").update(sessionToken).digest("hex"), scopes, expiresAt, acknowledgedAt: now } });
  });
  return { bookingId, token: sessionToken, expiresAt };
}
