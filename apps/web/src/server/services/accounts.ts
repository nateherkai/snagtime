import { randomBytes, randomUUID } from "node:crypto";
import type { AccountSummary, RegistrationInput, WorkspaceInvitation, WorkspaceMember, WorkspaceRole, WorkspaceSummary } from "@/lib/contracts";
import { db } from "@/server/db";
import { AppError, conflict, notFound } from "@/server/errors";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { enterBootstrapDatabaseContext, enterCapabilityDatabaseContext,enterDatabaseAction } from "@/server/db-context";
import { createSessionToken, readSessionToken, sessionTokenHash, type WorkspaceAccess } from "@/server/auth/session";
import { mapUser } from "@/server/mappers";
import { canonicalizeImageDataUrl } from "@/server/image-ingestion";
import { accountTokenBinding, actionTokenHash, actionTokenId, createActionToken, enqueueEmail, invitationTokenBinding, tokenHashMatches } from "@/server/services/notifications";

function mapWorkspaceMembership(membership: { role: string; workspace: { id: string; name: string; timeZone: string; onboardingCompletedAt: Date | null } }): WorkspaceSummary {
  return { id: membership.workspace.id, name: membership.workspace.name, timeZone: membership.workspace.timeZone, role: membership.role as WorkspaceRole, onboardingCompleted: Boolean(membership.workspace.onboardingCompletedAt) };
}

export async function getAccountSummary(access: WorkspaceAccess): Promise<AccountSummary> {
  const [memberships, members] = await Promise.all([
    db.membership.findMany({ where: { userId: access.user.id, status: "ACTIVE" }, include: { workspace: true }, orderBy: { createdAt: "asc" } }),
    db.membership.findMany({ where: { workspaceId: access.workspaceId }, include: { user: true }, orderBy: [{ role: "asc" }, { createdAt: "asc" }] }),
  ]);
  const activeMembership = memberships.find((membership) => membership.workspaceId === access.workspaceId);
  if (!activeMembership) throw new AppError("FORBIDDEN", "You do not have access to this workspace.", 403);
  return {
    user: mapUser(access.user),
    workspace: mapWorkspaceMembership(activeMembership),
    workspaces: memberships.map(mapWorkspaceMembership),
    members: members.map((membership) => ({ id: membership.id, userId: membership.userId, name: membership.user.name, email: membership.user.email, role: membership.role as WorkspaceRole, status: membership.status as WorkspaceMember["status"] })),
  };
}

export async function updateProfileImage(access: WorkspaceAccess, imageUrl: string | null) {
  enterDatabaseAction("account_write");
  const canonicalImage = imageUrl === null ? null : await canonicalizeImageDataUrl(imageUrl, "imageUrl");
  const user = await db.user.update({ where: { id: access.user.id }, data: { imageUrl: canonicalImage } });
  return mapUser(user);
}

export type RegistrationWorkPhase = "PASSWORD_KDF" | "USER_INSERT" | "WORKSPACE_INSERT" | "MEMBERSHIP_INSERT" | "BRANDING_INSERT" | "AVAILABILITY_INSERT" | "TOKEN_REVOKE" | "TOKEN_INSERT" | "OUTBOX_INSERT";
const observeNoRegistrationWork: (phase: RegistrationWorkPhase) => void = () => undefined;

export async function registerAccount(input: RegistrationInput, observeWork: (phase: RegistrationWorkPhase) => void = observeNoRegistrationWork, now = new Date()) {
  const email=input.email.trim().toLowerCase(),userId=randomUUID(),workspaceId=randomUUID(); enterBootstrapDatabaseContext(email,userId,workspaceId);
  const passwordHash = await hashPassword(input.password);
  observeWork("PASSWORD_KDF");
  const membershipId=randomUUID(),brandingId=randomUUID(),scheduleId=randomUUID(),tokenId=randomBytes(18).toString("base64url"),outboxId=randomUUID();
  const expiresAt=new Date(now.getTime()+24*60*60_000),binding=accountTokenBinding(workspaceId,userId,email),authority=createActionToken("EMAIL_VERIFY",binding,tokenId);
  const payloadJson=JSON.stringify({tokenId}),idempotencyKey=`email:EMAIL_VERIFY:${tokenId}`;
  await db.$transaction(async (tx) => {
    const inserted=await tx.$queryRaw<Array<{id:string}>>`INSERT INTO "User" ("id","email","name","timeZone","passwordHash","createdAt","updatedAt")
      VALUES (${userId},${email},${input.name},${input.timeZone},${passwordHash},${now},${now}) ON CONFLICT("email") DO NOTHING RETURNING "id"`;
    const created=inserted.length===1?1:0; observeWork("USER_INSERT");
    await tx.$executeRaw`INSERT INTO "Workspace" ("id","name","timeZone","createdAt","updatedAt") SELECT ${workspaceId},${input.workspaceName},${input.timeZone},${now},${now} WHERE ${created}=1`; observeWork("WORKSPACE_INSERT");
    await tx.$executeRaw`INSERT INTO "Membership" ("id","workspaceId","userId","role","status","createdAt","updatedAt") SELECT ${membershipId},${workspaceId},${userId},'OWNER','ACTIVE',${now},${now} WHERE ${created}=1`; observeWork("MEMBERSHIP_INSERT");
    await tx.$executeRaw`INSERT INTO "WorkspaceBranding" ("id","workspaceId","userId","workspaceName","accentColor") SELECT ${brandingId},${workspaceId},${userId},${input.workspaceName},'#2563EB' WHERE ${created}=1`; observeWork("BRANDING_INSERT");
    await tx.$executeRaw`INSERT INTO "AvailabilitySchedule" ("id","workspaceId","userId","timeZone","createdAt","updatedAt") SELECT ${scheduleId},${workspaceId},${userId},${input.timeZone},${now},${now} WHERE ${created}=1`; observeWork("AVAILABILITY_INSERT");
    await tx.$executeRaw`UPDATE "AccountActionToken" SET "revokedAt"=${now} WHERE "userId"=${userId} AND purpose='EMAIL_VERIFY' AND "consumedAt" IS NULL AND "revokedAt" IS NULL AND ${created}=1`; observeWork("TOKEN_REVOKE");
    await tx.$executeRaw`INSERT INTO "AccountActionToken" ("id","workspaceId","userId","purpose","email","tokenHash","expiresAt","createdAt") SELECT ${tokenId},${workspaceId},${userId},'EMAIL_VERIFY',${email},${authority.tokenHash},${expiresAt},${now} WHERE ${created}=1`; observeWork("TOKEN_INSERT");
    await tx.$executeRaw`INSERT INTO "EmailOutbox" ("id","workspaceId","kind","recipientEmail","subjectSnapshot","payloadJson","idempotencyKey","nextAttemptAt","createdAt","updatedAt") SELECT ${outboxId},${workspaceId},'EMAIL_VERIFY',${email},'Verify your SnagTime email',${payloadJson},${idempotencyKey},${now},${now},${now} WHERE ${created}=1`; observeWork("OUTBOX_INSERT");
  });
  return { accepted: true as const };
}

export async function changeAccountPassword(access: WorkspaceAccess, currentPassword: string, newPassword: string) {
  enterDatabaseAction("account_write");
  if (!await verifyPassword(currentPassword, access.user.passwordHash)) throw new AppError("AUTHENTICATION_FAILED", "The account request could not be completed.", 401);
  const passwordHash = await hashPassword(newPassword); const token = createSessionToken(access.user.id); const payload = readSessionToken(token)!; const now = new Date();
  await db.$transaction(async (tx) => {
    const changed = await tx.user.updateMany({ where: { id: access.user.id, passwordHash: access.user.passwordHash }, data: { passwordHash } });
    if (changed.count !== 1) throw new AppError("AUTHENTICATION_FAILED", "The account request could not be completed.", 401);
    await tx.authSession.updateMany({ where: { userId: access.user.id, revokedAt: null }, data: { revokedAt: now } });
    await tx.authSession.create({ data: { userId: access.user.id, activeWorkspaceId: access.workspaceId, membershipId: access.membership.id, tokenHash: sessionTokenHash(token), expiresAt: new Date(payload.expiresAt) } });
  });
  return token;
}

export async function completeWorkspaceOnboarding(access: WorkspaceAccess) {
  enterDatabaseAction("workspace_update");
  await db.workspace.update({ where: { id: access.workspaceId }, data: { onboardingCompletedAt: new Date() } });
}

export async function listWorkspaceInvitations(workspaceId: string): Promise<WorkspaceInvitation[]> {
  return (await db.workspaceInvitation.findMany({ where: { workspaceId }, orderBy: { createdAt: "desc" } })).map((item) => ({ id: item.id, email: item.email, role: item.role as WorkspaceInvitation["role"], status: item.status as WorkspaceInvitation["status"], expiresAt: item.expiresAt.toISOString() }));
}

export async function createWorkspaceInvitation(access: WorkspaceAccess, email: string, role: "ADMIN" | "MEMBER") {
  enterDatabaseAction("invitation_write");
  const normalized = email.toLowerCase(); const newId = randomBytes(18).toString("base64url");
  await db.$transaction(async (tx) => {
    const actor = await tx.membership.findFirst({ where: { id: access.membership.id, workspaceId: access.workspaceId, userId: access.user.id, status: "ACTIVE", role: { in: ["OWNER","ADMIN"] } } });
    if (!actor) throw new AppError("FORBIDDEN", "You do not have access to this workspace action.", 403);
    if (await tx.membership.findFirst({ where: { workspaceId: access.workspaceId, user: { email: normalized }, status: "ACTIVE" } })) { createActionToken("WORKSPACE_INVITATION", invitationTokenBinding(access.workspaceId, normalized, role, 1), newId); return; }
    const prior = await tx.workspaceInvitation.findUnique({ where: { workspaceId_email_status: { workspaceId: access.workspaceId, email: normalized, status: "PENDING" } } });
    const id = prior?.id ?? newId; const version = (prior?.tokenVersion ?? 0) + 1; const binding = invitationTokenBinding(access.workspaceId, normalized, role, version); const authority = createActionToken("WORKSPACE_INVITATION", binding, id); const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60_000);
    const invitation = prior
      ? await tx.workspaceInvitation.update({ where: { id }, data: { role, invitedById: access.user.id, expiresAt, tokenVersion: version, tokenHash: authority.tokenHash } })
      : await tx.workspaceInvitation.create({ data: { id, workspaceId: access.workspaceId, email: normalized, role, invitedById: access.user.id, expiresAt, tokenVersion: version, tokenHash: authority.tokenHash } });
    await enqueueEmail(tx, { workspaceId: access.workspaceId, kind: "WORKSPACE_INVITATION", recipientEmail: normalized, subject: `Invitation to ${access.workspace.name}`, payload: { invitationId: invitation.id, tokenVersion: version, workspaceName: access.workspace.name }, idempotencyKey: `email:invitation:${invitation.id}:${version}` });
  });
  return { accepted: true as const };
}

function invalidInvitation() { return new AppError("INVALID_OR_EXPIRED_TOKEN", "This invitation is invalid or expired.", 400); }
export async function acceptWorkspaceInvitation(access: WorkspaceAccess, token: string, now = new Date()) {
  const id = actionTokenId(token); if (!id || !access.user.emailVerifiedAt) throw invalidInvitation();
  enterCapabilityDatabaseContext(id,access.user.id);
  enterDatabaseAction("invitation_accept");
  let acceptedWorkspaceId = "";
  await db.$transaction(async (tx) => {
    const invitation = await tx.workspaceInvitation.findUnique({ where: { id } });
    if (!invitation || invitation.status !== "PENDING" || invitation.acceptedAt || invitation.expiresAt <= now || !invitation.tokenHash || invitation.email !== access.user.email.toLowerCase() || !["ADMIN","MEMBER"].includes(invitation.role)) throw invalidInvitation();
    const binding = invitationTokenBinding(invitation.workspaceId, invitation.email, invitation.role, invitation.tokenVersion);
    if (!tokenHashMatches(actionTokenHash(token, "WORKSPACE_INVITATION", binding), invitation.tokenHash)) throw invalidInvitation();
    const inviter = await tx.membership.findFirst({ where: { workspaceId: invitation.workspaceId, userId: invitation.invitedById, status: "ACTIVE", role: { in: ["OWNER","ADMIN"] } } });
    if (!inviter) throw invalidInvitation();
    if (process.env.DATABASE_PROVIDER === "postgresql" && process.env.NODE_ENV === "production") {
      const accepted = await tx.$queryRawUnsafe<Array<{ workspace_id: string }>>("SELECT tempocove_accept_invitation($1::text,$2::text,$3::timestamptz) AS workspace_id", invitation.id, invitation.tokenHash, now);
      if (accepted[0]?.workspace_id !== invitation.workspaceId) throw invalidInvitation();
      acceptedWorkspaceId = invitation.workspaceId;
      return;
    }
    const existing = await tx.membership.findUnique({ where: { workspaceId_userId: { workspaceId: invitation.workspaceId, userId: access.user.id } } });
    if (existing?.status === "ACTIVE") throw invalidInvitation();
    if (existing) await tx.membership.update({ where: { id: existing.id }, data: { status: "ACTIVE", role: invitation.role } });
    else await tx.membership.create({ data: { workspaceId: invitation.workspaceId, userId: access.user.id, role: invitation.role, status: "ACTIVE" } });
    const consumed = await tx.workspaceInvitation.updateMany({ where: { id: invitation.id, status: "PENDING", tokenHash: invitation.tokenHash, acceptedAt: null, expiresAt: { gt: now } }, data: { status: "ACCEPTED", acceptedAt: now, acceptedById: access.user.id, tokenHash: null } });
    if (consumed.count !== 1) throw invalidInvitation(); acceptedWorkspaceId = invitation.workspaceId;
  });
  return { accepted: true as const, workspaceId: acceptedWorkspaceId };
}

export async function updateMembershipRole(access: WorkspaceAccess, membershipId: string, role: WorkspaceRole, status: "ACTIVE" | "REMOVED") {
  enterDatabaseAction("membership_change");
  await db.$transaction(async (tx) => {
    const actor = await tx.membership.findFirst({ where: { id: access.membership.id, workspaceId: access.workspaceId, userId: access.user.id, role: "OWNER", status: "ACTIVE" } });
    if (!actor) throw new AppError("FORBIDDEN", "You do not have access to this workspace action.", 403);
    const target = await tx.membership.findFirst({ where: { id: membershipId, workspaceId: access.workspaceId } });
    if (!target) throw notFound("Membership");
    if (target.role === "OWNER" && (role !== "OWNER" || status !== "ACTIVE")) {
      const owners = await tx.membership.count({ where: { workspaceId: access.workspaceId, role: "OWNER", status: "ACTIVE" } });
      if (owners <= 1) throw conflict("A workspace must retain at least one active owner.");
    }
    const rank = { OWNER: 3, ADMIN: 2, MEMBER: 1 } as const;
    if (status !== "ACTIVE" || rank[role] < rank[target.role as WorkspaceRole]) {
      const [activeEvents, openBookings, providerWork, oauthCustody] = await Promise.all([
        tx.eventType.count({ where: { workspaceId: access.workspaceId, ownerId: target.userId, isActive: true } }),
        tx.booking.count({ where: { workspaceId: access.workspaceId, hostId: target.userId, status: { in: ["CONFIRMED", "PENDING_PAYMENT"] } } }),
        tx.integrationOutbox.count({ where: { workspaceId: access.workspaceId, status: { in: ["PENDING", "RETRY", "PROCESSING"] }, booking: { hostId: target.userId } } }),
        tx.oAuthConnection.count({ where: { workspaceId: access.workspaceId, userId: target.userId } }),
      ]);
      if (activeEvents || openBookings || providerWork || oauthCustody) throw conflict("Transfer or close this member's active events, bookings, provider work, and Google credential before changing their workspace authority.");
    }
    await tx.membership.update({ where: { id: target.id }, data: { role, status } });
    if (status !== "ACTIVE") await tx.authSession.updateMany({ where: { membershipId: target.id, revokedAt: null }, data: { revokedAt: new Date() } });
  });
}
