import { randomBytes, randomUUID } from "node:crypto";
import { db } from "@/server/db";
import { AppError } from "@/server/errors";
import { hashPassword } from "@/server/auth/password";
import { accountTokenBinding, actionTokenHash, actionTokenId, createActionToken, tokenHashMatches } from "@/server/services/notifications";
import { enterAuthDatabaseContext, enterCapabilityDatabaseContext } from "@/server/db-context";

export type AccountTokenPurpose = "EMAIL_VERIFY" | "PASSWORD_RESET";
const DUMMY_PASSWORD = "Comparable!Recovery9";
export type AccountRecoveryWorkPhase = "PASSWORD_KDF" | "ACCOUNT_LOOKUP" | "ACCOUNT_LOCK" | "PREDECESSOR_REVOKE" | "TOKEN_INSERT" | "OUTBOX_INSERT";
const observeNoRecoveryWork: (phase: AccountRecoveryWorkPhase) => void = () => undefined;

async function requestAccountAction(emailInput: string, purpose: AccountTokenPurpose, now: Date, observeWork: (phase: AccountRecoveryWorkPhase) => void) {
  const email = emailInput.trim().toLowerCase(); await hashPassword(DUMMY_PASSWORD); observeWork("PASSWORD_KDF");
  const action = purpose === "PASSWORD_RESET" ? "password_reset_request" : "email_verify_request";
  enterAuthDatabaseContext(email, undefined, undefined, action);
  const rows=await db.$queryRaw<Array<{id:string;emailVerifiedAt:Date|null;workspaceId:string|null}>>`SELECT u."id",u."emailVerifiedAt",
    (SELECT m."workspaceId" FROM "Membership" m WHERE m."userId"=u."id" AND m."status"='ACTIVE' ORDER BY m."createdAt" ASC LIMIT 1) AS "workspaceId"
    FROM "User" u WHERE u."email"=${email} LIMIT 1`;
  const user=rows[0]; observeWork("ACCOUNT_LOOKUP");
  if (user?.workspaceId) enterAuthDatabaseContext(email, user.id, user.workspaceId, action);
  const userId=user?.id??`ineligible-user-${randomUUID()}`,workspaceId=user?.workspaceId??`ineligible-workspace-${randomUUID()}`;
  const tokenId=randomBytes(18).toString("base64url"),outboxId=randomUUID(),binding=accountTokenBinding(workspaceId,userId,email),authority=createActionToken(purpose,binding,tokenId);
  const expiresAt=new Date(now.getTime()+(purpose==="PASSWORD_RESET"?30*60_000:24*60*60_000));
  const payloadJson=JSON.stringify({tokenId}),idempotencyKey=`email:${purpose}:${tokenId}`,subject=purpose==="EMAIL_VERIFY"?"Verify your SnagTime email":"Reset your SnagTime password";
  await db.$transaction(async(tx)=>{
    if(process.env.DATABASE_PROVIDER==="postgresql"&&process.env.NODE_ENV==="production") await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`tempocove-account-recovery-v1\0${purpose}\0${email}`},0)) IS NULL AS "recovery_lock"`;
    else await tx.$queryRaw`SELECT ${email} AS "recovery_lock"`;
    const locked=await tx.$queryRaw<Array<{emailVerifiedAt:Date|null}>>`SELECT u."emailVerifiedAt" FROM "User" u JOIN "Membership" m ON m."userId"=u."id"
      WHERE u."id"=${userId} AND m."workspaceId"=${workspaceId} AND m."status"='ACTIVE' LIMIT 1`;
    observeWork("ACCOUNT_LOCK");
    const eligible=Boolean(locked[0]&&(purpose==="PASSWORD_RESET"||!locked[0].emailVerifiedAt)),eligibleNumber=eligible?1:0;
    await tx.$executeRaw`UPDATE "AccountActionToken" SET "revokedAt"=${now} WHERE "userId"=${userId} AND purpose=${purpose} AND "consumedAt" IS NULL AND "revokedAt" IS NULL AND ${eligibleNumber}=1`; observeWork("PREDECESSOR_REVOKE");
    await tx.$executeRaw`INSERT INTO "AccountActionToken" ("id","workspaceId","userId","purpose","email","tokenHash","expiresAt","createdAt") SELECT ${tokenId},${workspaceId},${userId},${purpose},${email},${authority.tokenHash},${expiresAt},${now} WHERE ${eligibleNumber}=1`; observeWork("TOKEN_INSERT");
    await tx.$executeRaw`INSERT INTO "EmailOutbox" ("id","workspaceId","kind","recipientEmail","subjectSnapshot","payloadJson","idempotencyKey","nextAttemptAt","createdAt","updatedAt") SELECT ${outboxId},${workspaceId},${purpose},${email},${subject},${payloadJson},${idempotencyKey},${now},${now},${now} WHERE ${eligibleNumber}=1`; observeWork("OUTBOX_INSERT");
  });
  return { accepted: true as const };
}
export const requestPasswordReset = (email: string, now = new Date(), observeWork: (phase: AccountRecoveryWorkPhase) => void = observeNoRecoveryWork) => requestAccountAction(email, "PASSWORD_RESET", now, observeWork);
export const requestEmailVerification = (email: string, now = new Date(), observeWork: (phase: AccountRecoveryWorkPhase) => void = observeNoRecoveryWork) => requestAccountAction(email, "EMAIL_VERIFY", now, observeWork);

function invalidToken() { return new AppError("INVALID_OR_EXPIRED_TOKEN", "This link is invalid or expired.", 400); }
export async function verifyEmail(token: string, now = new Date()) {
  const id = actionTokenId(token); if (!id) throw invalidToken();
  enterCapabilityDatabaseContext(id, undefined, undefined, "account_token_resolve");
  const authority = await db.accountActionToken.findUnique({ where: { id }, select: { workspaceId: true, userId: true, email: true } });
  if (!authority) throw invalidToken();
  enterAuthDatabaseContext(authority.email, authority.userId, authority.workspaceId, "email_verify_consume");
  await db.$transaction(async (tx) => {
    const record = await tx.accountActionToken.findUnique({ where: { id } });
    if (!record || record.purpose !== "EMAIL_VERIFY" || record.consumedAt || record.revokedAt || record.expiresAt <= now) throw invalidToken();
    if (await tx.membership.count({ where: { workspaceId: record.workspaceId, userId: record.userId, status: "ACTIVE" } }) !== 1) throw invalidToken();
    const binding = accountTokenBinding(record.workspaceId, record.userId, record.email);
    if (!tokenHashMatches(actionTokenHash(token, record.purpose, binding), record.tokenHash)) throw invalidToken();
    if (process.env.DATABASE_PROVIDER === "postgresql" && process.env.NODE_ENV === "production") {
      const rows = await tx.$queryRawUnsafe<Array<{ consumed: boolean }>>("SELECT tempocove_consume_email_verification($1::text,$2::text,$3::timestamptz) AS consumed", record.id, record.tokenHash, now);
      if (rows[0]?.consumed !== true) throw invalidToken();
      return;
    }
    const consumed = await tx.accountActionToken.updateMany({ where: { id: record.id, purpose: "EMAIL_VERIFY", tokenHash: record.tokenHash, consumedAt: null, revokedAt: null, expiresAt: { gt: now } }, data: { consumedAt: now } });
    if (consumed.count !== 1) throw invalidToken();
    const verified = await tx.user.updateMany({ where: { id: record.userId, email: record.email }, data: { emailVerifiedAt: now } });
    if (verified.count !== 1) throw invalidToken();
  });
  return { verified: true as const };
}

export async function resetPassword(token: string, newPassword: string, now = new Date()) {
  const passwordHash = await hashPassword(newPassword); const id = actionTokenId(token); if (!id) throw invalidToken();
  enterCapabilityDatabaseContext(id, undefined, undefined, "account_token_resolve");
  const authority = await db.accountActionToken.findUnique({ where: { id }, select: { workspaceId: true, userId: true, email: true } });
  if (!authority) throw invalidToken();
  enterAuthDatabaseContext(authority.email, authority.userId, authority.workspaceId, "password_reset_consume");
  await db.$transaction(async (tx) => {
    const record = await tx.accountActionToken.findUnique({ where: { id } });
    if (!record || record.purpose !== "PASSWORD_RESET" || record.consumedAt || record.revokedAt || record.expiresAt <= now) throw invalidToken();
    if (await tx.membership.count({ where: { workspaceId: record.workspaceId, userId: record.userId, status: "ACTIVE" } }) !== 1) throw invalidToken();
    const binding = accountTokenBinding(record.workspaceId, record.userId, record.email);
    if (!tokenHashMatches(actionTokenHash(token, record.purpose, binding), record.tokenHash)) throw invalidToken();
    if (process.env.DATABASE_PROVIDER === "postgresql" && process.env.NODE_ENV === "production") {
      const rows = await tx.$queryRawUnsafe<Array<{ consumed: boolean }>>("SELECT tempocove_consume_password_reset($1::text,$2::text,$3::text,$4::timestamptz) AS consumed", record.id, record.tokenHash, passwordHash, now);
      if (rows[0]?.consumed !== true) throw invalidToken();
      return;
    }
    const consumed = await tx.accountActionToken.updateMany({ where: { id: record.id, purpose: "PASSWORD_RESET", tokenHash: record.tokenHash, consumedAt: null, revokedAt: null, expiresAt: { gt: now } }, data: { consumedAt: now } });
    if (consumed.count !== 1) throw invalidToken();
    await tx.user.update({ where: { id: record.userId }, data: { passwordHash } });
    await tx.authSession.updateMany({ where: { userId: record.userId, revokedAt: null }, data: { revokedAt: now } });
    await tx.accountActionToken.updateMany({ where: { userId: record.userId, purpose: "PASSWORD_RESET", id: { not: record.id }, consumedAt: null, revokedAt: null }, data: { revokedAt: now } });
  });
  return { reset: true as const, signInRequired: true as const };
}
