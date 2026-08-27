import { randomUUID } from "node:crypto";
import { SMTPServer } from "smtp-server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { createSessionForUser, type WorkspaceAccess } from "@/server/auth/session";
import { verifyPassword } from "@/server/auth/password";
import { acceptWorkspaceInvitation, createWorkspaceInvitation, registerAccount } from "@/server/services/accounts";
import { requestEmailVerification, requestPasswordReset, resetPassword, verifyEmail } from "@/server/services/account-recovery";
import { consumeBookingManageLink, requestBookingManageLink } from "@/server/services/booking-recovery";
import { enqueueBookingEmail, enqueueEmail, listLocalInbox, processEmailOutbox, SmtpEmailProvider, type EmailDelivery, type EmailProvider } from "@/server/services/notifications";
import { POST as requestManageLinkRoute } from "@/app/api/bookings/manage-link/route";
import { POST as requestPasswordResetRoute } from "@/app/api/auth/password-reset/request/route";
import { resetRateLimitsForTest } from "@/server/rate-limit";

const workspaceIds: string[] = []; const userIds: string[] = [];
class CaptureProvider implements EmailProvider { messages: EmailDelivery[] = []; async send(message: EmailDelivery) { this.messages.push(message); } }
async function fixture(label: string, role = "OWNER") {
  const user = await db.user.create({ data: { email: `${label}-${randomUUID()}@example.com`, name: label, passwordHash: "test", emailVerifiedAt: new Date(), timeZone: "America/Chicago" } });
  const workspace = await db.workspace.create({ data: { name: `${label} workspace`, timeZone: "America/Chicago" } });
  const membership = await db.membership.create({ data: { workspaceId: workspace.id, userId: user.id, role } });
  workspaceIds.push(workspace.id); userIds.push(user.id);
  return { user, workspace, membership, access: { sessionId: "test", user, workspace, membership, workspaceId: workspace.id, role } as WorkspaceAccess };
}
function linkToken(text: string) { const match = text.match(/[?#&](?:token|recovery)=([^\s]+)/); if (!match) throw new Error("token missing"); return decodeURIComponent(match[1]!); }

describe("transactional email and recovery authority", () => {
  beforeEach(() => { process.env.AUTH_SECRET = "notification-test-auth-secret-that-is-long-enough"; process.env.EMAIL_TOKEN_SECRET = "email-test-secret-that-is-more-than-thirty-two-bytes"; process.env.TOKEN_ENCRYPTION_KEY = "00112233445566778899aabbccddeeffffeeddccbbaa99887766554433221100"; process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000"; process.env.EMAIL_REPLY_TO = "support@example.invalid"; });
  afterEach(async () => { const owned = workspaceIds.splice(0); await db.booking.deleteMany({ where: { workspaceId: { in: owned } } }); await db.workspace.deleteMany({ where: { id: { in: owned } } }); await db.user.deleteMany({ where: { id: { in: userIds.splice(0) } } }); for (const name of ["AUTH_SECRET","EMAIL_TOKEN_SECRET","TOKEN_ENCRYPTION_KEY","NEXT_PUBLIC_APP_URL","SMTP_HOST","SMTP_PORT","SMTP_USER","SMTP_PASSWORD","EMAIL_FROM","EMAIL_REPLY_TO","EMAIL_SENDER_DOMAIN","SMTP_TLS_MODE","SMTP_ALLOW_SELF_SIGNED"]) delete process.env[name]; });

  it("queues registration verification without plaintext authority and consumes it once", async () => {
    const email = `verify-${randomUUID()}@example.com`; await registerAccount({ name: "Verify", email, password: "Strong!Password9", workspaceName: "Verify workspace", timeZone: "UTC" });
    const user = await db.user.findUniqueOrThrow({ where: { email }, include: { memberships: true } }); workspaceIds.push(user.memberships[0]!.workspaceId); userIds.push(user.id);
    expect(user.emailVerifiedAt).toBeNull(); const provider = new CaptureProvider(); await processEmailOutbox(user.memberships[0]!.workspaceId, new Date(), provider); expect(provider.messages[0]!.text).toContain("/verify-email#token="); expect(provider.messages[0]!.text).not.toContain("/verify-email?token=");
    const token = linkToken(provider.messages[0]!.text); const stored = await db.accountActionToken.findFirstOrThrow({ where: { userId: user.id, purpose: "EMAIL_VERIFY" } });
    expect(JSON.stringify(stored)).not.toContain(token); expect((await db.emailOutbox.findFirstOrThrow({ where: { workspaceId: user.memberships[0]!.workspaceId } })).payloadJson).not.toContain(token);
    const races = await Promise.allSettled([verifyEmail(token), verifyEmail(token)]); expect(races.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerifiedAt).not.toBeNull();
  });

  it("resets a password once, revokes sessions, and keeps request responses generic", async () => {
    const owner = await fixture("reset"); const passwordHash = await import("@/server/auth/password").then(({ hashPassword }) => hashPassword("Old!Password9")); await db.user.update({ where: { id: owner.user.id }, data: { passwordHash } });
    const eligiblePhases:string[]=[],absentPhases:string[]=[],absentEmail=`absent-${randomUUID()}@example.com`;await createSessionForUser(owner.user.id, owner.membership.id); await expect(requestPasswordReset(owner.user.email,new Date(),phase=>eligiblePhases.push(phase))).resolves.toEqual({ accepted: true }); await expect(requestPasswordReset(absentEmail,new Date(),phase=>absentPhases.push(phase))).resolves.toEqual({ accepted: true });
    expect(eligiblePhases).toEqual(["PASSWORD_KDF","ACCOUNT_LOOKUP","ACCOUNT_LOCK","PREDECESSOR_REVOKE","TOKEN_INSERT","OUTBOX_INSERT"]);expect(absentPhases).toEqual(eligiblePhases);
    expect(await db.emailOutbox.count({where:{recipientEmail:absentEmail}})).toBe(0);
    const provider = new CaptureProvider(); await processEmailOutbox(owner.workspace.id, new Date(), provider); const token = linkToken(provider.messages.find((item) => item.text.includes("reset-password"))!.text);
    const races = await Promise.allSettled([resetPassword(token, "New!Password9"), resetPassword(token, "Other!Password9")]); expect(races.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    const updated = await db.user.findUniqueOrThrow({ where: { id: owner.user.id } }); expect(await verifyPassword("New!Password9", updated.passwordHash) || await verifyPassword("Other!Password9", updated.passwordHash)).toBe(true);
    expect(await db.authSession.count({ where: { userId: owner.user.id, revokedAt: null } })).toBe(0);
  });

  it("keeps verification work fixed for eligible, verified, and absent accounts",async()=>{
    const email=`unverified-${randomUUID()}@example.com`;await registerAccount({name:"Unverified",email,password:"Strong!Password9",workspaceName:"Unverified workspace",timeZone:"UTC"});
    const unverified=await db.user.findUniqueOrThrow({where:{email},include:{memberships:true}});userIds.push(unverified.id);workspaceIds.push(unverified.memberships[0]!.workspaceId);
    const verified=await fixture("verified-recovery"),eligible:string[]=[],ineligible:string[]=[],absent:string[]=[];
    await requestEmailVerification(email,new Date(),phase=>eligible.push(phase));await requestEmailVerification(verified.user.email,new Date(),phase=>ineligible.push(phase));await requestEmailVerification(`absent-${randomUUID()}@example.com`,new Date(),phase=>absent.push(phase));
    expect(eligible).toEqual(["PASSWORD_KDF","ACCOUNT_LOOKUP","ACCOUNT_LOCK","PREDECESSOR_REVOKE","TOKEN_INSERT","OUTBOX_INSERT"]);expect(ineligible).toEqual(eligible);expect(absent).toEqual(eligible);
    expect(await db.accountActionToken.count({where:{userId:verified.user.id,purpose:"EMAIL_VERIFY"}})).toBe(0);
    expect(await db.emailOutbox.count({where:{workspaceId:verified.workspace.id,kind:"EMAIL_VERIFY"}})).toBe(0);
  });

  it("serializes concurrent recovery requests to one current token",async()=>{
    const owner=await fixture("recovery-race"),traces=Array.from({length:6},()=>[] as string[]),now=new Date();
    await expect(Promise.all(traces.map(trace=>requestPasswordReset(owner.user.email,now,phase=>trace.push(phase))))).resolves.toHaveLength(6);
    for(const trace of traces)expect(trace).toEqual(traces[0]);
    expect(await db.accountActionToken.count({where:{userId:owner.user.id,purpose:"PASSWORD_RESET",revokedAt:null,consumedAt:null}})).toBe(1);
    expect(await db.accountActionToken.count({where:{userId:owner.user.id,purpose:"PASSWORD_RESET"}})).toBe(6);
    expect(await db.emailOutbox.count({where:{workspaceId:owner.workspace.id,kind:"PASSWORD_RESET"}})).toBe(6);
  });

  it("keeps account recovery HTTP posture identical for eligible and absent accounts",async()=>{
    resetRateLimitsForTest();const owner=await fixture("recovery-http-account");
    async function call(email:string){const response=await requestPasswordResetRoute(new Request("http://localhost:3000/api/auth/password-reset/request",{method:"POST",headers:{origin:"http://localhost:3000","content-type":"application/json"},body:JSON.stringify({email})}));return{status:response.status,body:await response.text(),cookie:response.headers.get("set-cookie"),location:response.headers.get("location")};}
    const [eligible,absent]=await Promise.all([call(owner.user.email),call(`absent-${randomUUID()}@example.com`)]);
    expect(eligible).toEqual({status:202,body:'{"data":{"accepted":true}}',cookie:null,location:null});expect(absent).toEqual(eligible);
  });

  it("binds invitation acceptance to verified email, stored role, workspace, and live inviter", async () => {
    const inviter = await fixture("inviter"); const target = await fixture("target"); const wrong = await fixture("wrong");
    await expect(createWorkspaceInvitation(inviter.access, target.user.email, "MEMBER")).resolves.toEqual({ accepted: true }); const provider = new CaptureProvider(); await processEmailOutbox(inviter.workspace.id, new Date(), provider); expect(provider.messages[0]!.text).toContain("/invite/accept#token="); expect(provider.messages[0]!.text).not.toContain("/invite/accept?token="); const token = linkToken(provider.messages[0]!.text);
    await expect(acceptWorkspaceInvitation(wrong.access, token)).rejects.toMatchObject({ code: "INVALID_OR_EXPIRED_TOKEN" });
    await db.membership.create({ data: { workspaceId: inviter.workspace.id, userId: wrong.user.id, role: "OWNER" } });
    await db.membership.update({ where: { id: inviter.membership.id }, data: { role: "MEMBER" } });
    await expect(acceptWorkspaceInvitation(target.access, token)).rejects.toMatchObject({ code: "INVALID_OR_EXPIRED_TOKEN" });
    await db.membership.update({ where: { id: inviter.membership.id }, data: { role: "OWNER" } });
    const races = await Promise.allSettled([acceptWorkspaceInvitation(target.access, token), acceptWorkspaceInvitation(target.access, token)]); expect(races.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(await db.membership.findUniqueOrThrow({ where: { workspaceId_userId: { workspaceId: inviter.workspace.id, userId: target.user.id } } })).toMatchObject({ role: "MEMBER", status: "ACTIVE" });
  });

  it("issues a generic, exact-booking manage recovery and consumes it once", async () => {
    const owner = await fixture("booking-recovery"); const event = await db.eventType.create({ data: { workspaceId: owner.workspace.id, ownerId: owner.user.id, name: "Recovery event", slug: `recovery-${randomUUID()}`, locationType: "CUSTOM" } });
    const booking = await db.booking.create({ data: { workspaceId: owner.workspace.id, eventTypeId: event.id, hostId: owner.user.id, durationMinutes: 30, inviteeName: "Guest", inviteeEmail: "guest@example.com", inviteeTimeZone: "UTC", startAt: new Date("2099-01-01T10:00:00Z"), endAt: new Date("2099-01-01T10:30:00Z"), eventTitleSnapshot: "Recovery event", capabilityVersion: randomUUID(), manageExpiresAt: new Date("2099-02-01T00:00:00Z") } });
    const missingPhases: string[] = []; const wrongPhases: string[] = []; const cancelledPhases: string[] = []; const eligiblePhases: string[] = [];
    await expect(requestBookingManageLink(randomUUID(), "guest@example.com", new Date(), (phase) => missingPhases.push(phase))).resolves.toEqual({ accepted: true });
    await expect(requestBookingManageLink(booking.id, "wrong@example.com", new Date(), (phase) => wrongPhases.push(phase))).resolves.toEqual({ accepted: true }); expect(await db.emailOutbox.count({ where: { bookingId: booking.id } })).toBe(0);
    const cancelled = await db.booking.create({ data: { workspaceId: owner.workspace.id, eventTypeId: event.id, hostId: owner.user.id, durationMinutes: 30, inviteeName: "Cancelled", inviteeEmail: "cancelled@example.com", inviteeTimeZone: "UTC", startAt: new Date("2099-01-02T10:00:00Z"), endAt: new Date("2099-01-02T10:30:00Z"), eventTitleSnapshot: "Recovery event", capabilityVersion: randomUUID(), manageExpiresAt: new Date("2099-02-01T00:00:00Z"), status: "CANCELLED" } });
    await requestBookingManageLink(cancelled.id, cancelled.inviteeEmail, new Date(), (phase) => cancelledPhases.push(phase));
    await requestBookingManageLink(booking.id, "guest@example.com", new Date(), (phase) => eligiblePhases.push(phase));
    expect(missingPhases).toEqual(eligiblePhases); expect(wrongPhases).toEqual(eligiblePhases); expect(cancelledPhases).toEqual(eligiblePhases);
    expect(await db.bookingRecoveryToken.count({ where: { bookingId: { in: [cancelled.id] } } })).toBe(0); expect(await db.emailOutbox.count({ where: { bookingId: cancelled.id } })).toBe(0);
    const provider = new CaptureProvider(); await processEmailOutbox(owner.workspace.id, new Date(), provider); expect(provider.messages[0]!.text).toContain(`/manage/${booking.id}/reschedule#recovery=`); expect(provider.messages[0]!.text).not.toContain(`/manage/${booking.id}/reschedule?recovery=`); const token = linkToken(provider.messages[0]!.text);
    const races = await Promise.allSettled([consumeBookingManageLink(token), consumeBookingManageLink(token)]); expect(races.filter((item) => item.status === "fulfilled")).toHaveLength(1); expect(await db.bookingManageSession.count({ where: { bookingId: booking.id, revokedAt: null } })).toBe(1);
  });

  it("keeps request HTTP posture identical for eligible, missing, wrong-email, and cancelled tuples", async () => {
    resetRateLimitsForTest(); const owner = await fixture("recovery-http"); const event = await db.eventType.create({ data: { workspaceId: owner.workspace.id, ownerId: owner.user.id, name: "HTTP event", slug: `http-${randomUUID()}`, locationType: "CUSTOM" } });
    const common = { workspaceId: owner.workspace.id, eventTypeId: event.id, hostId: owner.user.id, durationMinutes: 30, inviteeName: "Guest", inviteeTimeZone: "UTC", startAt: new Date("2099-03-01T10:00:00Z"), endAt: new Date("2099-03-01T10:30:00Z"), eventTitleSnapshot: "HTTP event", capabilityVersion: randomUUID(), manageExpiresAt: new Date("2099-04-01T00:00:00Z") };
    const eligible = await db.booking.create({ data: { ...common, inviteeEmail: "eligible@example.com" } }); const cancelled = await db.booking.create({ data: { ...common, capabilityVersion: randomUUID(), inviteeEmail: "cancelled-http@example.com", status: "CANCELLED" } });
    async function call(bookingId: string, email: string) { const response = await requestManageLinkRoute(new Request("http://localhost:3000/api/bookings/manage-link", { method: "POST", headers: { origin: "http://localhost:3000", "content-type": "application/json" }, body: JSON.stringify({ bookingId, email }) })); return { status: response.status, body: await response.text(), cookie: response.headers.get("set-cookie"), location: response.headers.get("location") }; }
    const responses = await Promise.all([call(eligible.id, eligible.inviteeEmail), call(randomUUID(), eligible.inviteeEmail), call(eligible.id, "wrong-http@example.com"), call(cancelled.id, cancelled.inviteeEmail)]);
    for (const response of responses) expect(response).toEqual({ status: 202, body: '{"data":{"accepted":true}}', cookie: null, location: null });
  });

  it("suppresses stale booking versions and recovers an expired lease without duplicate logical delivery", async () => {
    const owner = await fixture("email-stale"); const event = await db.eventType.create({ data: { workspaceId: owner.workspace.id, ownerId: owner.user.id, name: "Stale event", slug: `stale-${randomUUID()}`, locationType: "CUSTOM" } });
    let booking = await db.booking.create({ data: { workspaceId: owner.workspace.id, eventTypeId: event.id, hostId: owner.user.id, durationMinutes: 30, inviteeName: "Guest", inviteeEmail: "stale@example.com", inviteeTimeZone: "America/Chicago", startAt: new Date("2099-01-01T10:00:00Z"), endAt: new Date("2099-01-01T10:30:00Z"), eventTitleSnapshot: "Stale event", capabilityVersion: randomUUID(), manageExpiresAt: new Date("2099-02-01T00:00:00Z") } });
    await db.$transaction((tx) => enqueueBookingEmail(tx, booking, "BOOKING_CONFIRMED")); booking = await db.booking.update({ where: { id: booking.id }, data: { mutationVersion: 1, startAt: new Date("2099-01-02T10:00:00Z"), endAt: new Date("2099-01-02T10:30:00Z") } }); await db.$transaction((tx) => enqueueBookingEmail(tx, booking, "BOOKING_RESCHEDULED"));
    await db.emailOutbox.updateMany({ where: { bookingId: booking.id, bookingMutationVersion: 1 }, data: { status: "PROCESSING", leaseToken: "dead", leaseExpiresAt: new Date("2020-01-01Z") } });
    const provider = new CaptureProvider(); await processEmailOutbox(owner.workspace.id, new Date(), provider); await processEmailOutbox(owner.workspace.id, new Date(), provider);
    expect(provider.messages).toHaveLength(2); expect(provider.messages.every((message) => message.text.includes("rescheduled"))).toBe(true); expect(await db.emailOutbox.count({ where: { bookingId: booking.id, status: "SUPERSEDED" } })).toBe(2); expect(await db.emailOutbox.count({ where: { bookingId: booking.id, status: "COMPLETED" } })).toBe(2);
  });

  it("notifies the calendar owner without exposing invitee booking authority", async () => {
    const owner = await fixture("owner-notification"); const event = await db.eventType.create({ data: { workspaceId: owner.workspace.id, ownerId: owner.user.id, name: "Owner event", slug: `owner-${randomUUID()}`, locationType: "CUSTOM" } });
    const booking = await db.booking.create({ data: { workspaceId: owner.workspace.id, eventTypeId: event.id, hostId: owner.user.id, durationMinutes: 30, inviteeName: "Taylor Guest", inviteeEmail: "taylor@example.com", inviteeTimeZone: "America/New_York", startAt: new Date("2099-01-03T16:00:00Z"), endAt: new Date("2099-01-03T16:30:00Z"), eventTitleSnapshot: "Owner event", capabilityVersion: randomUUID(), manageExpiresAt: new Date("2099-02-03T00:00:00Z") } });
    await db.$transaction((tx) => enqueueBookingEmail(tx, booking, "BOOKING_CONFIRMED"));
    expect(await db.emailOutbox.count({ where: { bookingId: booking.id } })).toBe(2);
    const provider = new CaptureProvider(); await processEmailOutbox(owner.workspace.id, new Date(), provider);
    const invitee = provider.messages.find((message) => message.recipientEmail === booking.inviteeEmail)!; const organizer = provider.messages.find((message) => message.recipientEmail === owner.user.email)!;
    expect(invitee.text).toContain(`/manage/${booking.id}/reschedule#recovery=`); expect(invitee.text).not.toContain(`/manage/${booking.id}/reschedule?recovery=`); expect(invitee.replyTo).toBe("support@example.invalid"); expect(organizer.subject).toBe("New booking: Owner event"); expect(organizer.replyTo).toBe("taylor@example.com"); expect(organizer.text).toContain("Taylor Guest (taylor@example.com) confirmed Owner event"); expect(organizer.text).toContain(`/bookings?selected=${booking.id}`); expect(organizer.text).not.toContain("recovery=");
  });

  it("queues distinct invitee and organizer notices when both use the same address", async () => {
    const owner = await fixture("same-address"); const event = await db.eventType.create({ data: { workspaceId: owner.workspace.id, ownerId: owner.user.id, name: "Same address event", slug: `same-address-${randomUUID()}`, locationType: "CUSTOM" } });
    const booking = await db.booking.create({ data: { workspaceId: owner.workspace.id, eventTypeId: event.id, hostId: owner.user.id, durationMinutes: 30, inviteeName: "Owner as invitee", inviteeEmail: owner.user.email, inviteeTimeZone: "UTC", startAt: new Date("2099-04-01T10:00:00Z"), endAt: new Date("2099-04-01T10:30:00Z"), eventTitleSnapshot: "Same address event", capabilityVersion: randomUUID(), manageExpiresAt: new Date("2099-05-01T00:00:00Z") } });
    await db.$transaction((tx) => enqueueBookingEmail(tx, booking, "BOOKING_CONFIRMED"));
    expect(await db.emailOutbox.count({ where: { bookingId: booking.id } })).toBe(2);
    const provider = new CaptureProvider(); await processEmailOutbox(owner.workspace.id, new Date(), provider);
    expect(provider.messages).toHaveLength(2); expect(new Set(provider.messages.map((message) => message.subject)).size).toBe(2);
    expect(provider.messages.find((message) => message.subject.startsWith("New booking:"))?.replyTo).toBe(owner.user.email);
    expect(provider.messages.find((message) => !message.subject.startsWith("New booking:"))?.replyTo).toBe("support@example.invalid");
  });

  it("encrypts the bounded local inbox and disables it outside explicit demo mode", async () => {
    const owner = await fixture("local-inbox");
    await db.$transaction((tx) => enqueueEmail(tx, { workspaceId: owner.workspace.id, kind: "PASSWORD_RESET", recipientEmail: owner.user.email, subject: "Reset", payload: { tokenId: "missing" }, idempotencyKey: `missing:${randomUUID()}` }));
    process.env.DEMO_MODE = "true"; process.env.EMAIL_PROVIDER = "local";
    // A direct provider proof avoids manufacturing a usable authority merely for inbox validation.
    const local = new (await import("@/server/services/notifications")).LocalInboxEmailProvider();
    await local.send({ workspaceId: owner.workspace.id, outboxId: (await db.emailOutbox.findFirstOrThrow({ where: { workspaceId: owner.workspace.id } })).id, idempotencyKey: "local-proof", recipientEmail: owner.user.email, subject: "Local proof", text: "sanitized local delivery" });
    const stored = await db.localInboxMessage.findFirstOrThrow({ where: { workspaceId: owner.workspace.id } }); expect(stored.encryptedText).not.toContain("sanitized local delivery");
    expect((await listLocalInbox(owner.workspace.id))[0]!.text).toBe("sanitized local delivery");
    delete process.env.DEMO_MODE; await expect(listLocalInbox(owner.workspace.id)).rejects.toThrow("LOCAL_INBOX_DISABLED"); delete process.env.EMAIL_PROVIDER;
  });

  it("delivers through bounded STARTTLS SMTP with a deterministic message identity", async () => {
    let received = "";
    const server = new SMTPServer({ secure: false, authOptional: true, onAuth(auth, _session, callback) { callback(null, { user: auth.username }); }, onData(stream, _session, callback) { stream.on("data", (chunk) => { received += chunk.toString("utf8"); }); stream.on("end", () => callback()); } });
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    try {
      const address = server.server.address(); if (!address || typeof address === "string") throw new Error("SMTP test listener missing");
      process.env.SMTP_HOST = "127.0.0.1"; process.env.SMTP_PORT = String(address.port); process.env.SMTP_USER = "test"; process.env.SMTP_PASSWORD = "test"; process.env.EMAIL_FROM = "SnagTime <notifications@example.invalid>"; process.env.EMAIL_REPLY_TO = "support@example.invalid"; process.env.EMAIL_SENDER_DOMAIN = "example.invalid"; process.env.SMTP_TLS_MODE = "starttls"; process.env.SMTP_ALLOW_SELF_SIGNED = "true";
      const provider = new SmtpEmailProvider(); const delivery = { workspaceId: "smtp-workspace", outboxId: "smtp-outbox", idempotencyKey: "smtp-idempotency", recipientEmail: "recipient@example.invalid", replyTo: "invitee@example.net", subject: "SMTP proof", text: "bounded TLS delivery" };
      await provider.send(delivery);
      expect(received).toContain("bounded TLS delivery"); expect(received).toMatch(/From: SnagTime <notifications@example\.invalid>/i); expect(received).toMatch(/Reply-To: invitee@example\.net/i); expect(received).toMatch(/X-SnagTime-Dedupe:/i); expect(received).toMatch(/Message-ID:\s*\r?\n?\s*<[0-9a-f]{64}@snagtime\.invalid>/i);
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
  });

  it("rejects an unapproved or header-injected transactional sender identity", () => {
    process.env.SMTP_HOST = "smtp.example.invalid"; process.env.SMTP_PORT = "465"; process.env.SMTP_USER = "test"; process.env.SMTP_PASSWORD = "test"; process.env.SMTP_TLS_MODE = "implicit";
    process.env.EMAIL_REPLY_TO = "support@example.invalid"; process.env.EMAIL_SENDER_DOMAIN = "example.invalid";
    process.env.EMAIL_FROM = "attacker@elsewhere.invalid"; expect(() => new SmtpEmailProvider()).toThrow("SMTP_SENDER_IDENTITY_INVALID");
    process.env.EMAIL_FROM = "SnagTime <notifications@example.invalid>\r\nBcc: attacker@example.net"; expect(() => new SmtpEmailProvider()).toThrow("SMTP_MAILBOX_INVALID");
  });

  it("commits an acknowledged delivery even when shutdown is requested during the provider response",async()=>{
    const owner=await fixture("acknowledged-shutdown");await requestPasswordReset(owner.user.email);const controller=new AbortController();const acknowledged:EmailProvider={async send(){controller.abort();}};
    await processEmailOutbox(owner.workspace.id,new Date(),acknowledged,controller.signal);
    expect(await db.emailOutbox.findFirstOrThrow({where:{workspaceId:owner.workspace.id}})).toMatchObject({status:"COMPLETED",attemptCount:1,lastErrorCode:null});
  });

  it("releases an unacknowledged delivery without spending its retry budget on shutdown",async()=>{
    const owner=await fixture("aborted-shutdown");await requestPasswordReset(owner.user.email);const controller=new AbortController();const aborted:EmailProvider={async send(){controller.abort();throw new Error("delivery aborted")}};
    await processEmailOutbox(owner.workspace.id,new Date(),aborted,controller.signal);
    expect(await db.emailOutbox.findFirstOrThrow({where:{workspaceId:owner.workspace.id}})).toMatchObject({status:"RETRY",attemptCount:0,lastErrorCode:"WORKER_STOPPED",leaseToken:null,leaseExpiresAt:null});
  });

  it("moves repeatedly failing delivery to a terminal dead-letter state", async () => {
    const owner = await fixture("dead-letter"); const event = await db.eventType.create({ data: { workspaceId: owner.workspace.id, ownerId: owner.user.id, name: "DLQ event", slug: `dlq-${randomUUID()}`, locationType: "CUSTOM" } });
    const booking = await db.booking.create({ data: { workspaceId: owner.workspace.id, eventTypeId: event.id, hostId: owner.user.id, durationMinutes: 30, inviteeName: "Guest", inviteeEmail: "dlq@example.com", inviteeTimeZone: "UTC", startAt: new Date("2099-01-01T10:00:00Z"), endAt: new Date("2099-01-01T10:30:00Z"), eventTitleSnapshot: "DLQ event", capabilityVersion: randomUUID(), manageExpiresAt: new Date("2099-02-01T00:00:00Z") } });
    await db.$transaction((tx) => enqueueBookingEmail(tx, booking, "BOOKING_CONFIRMED")); const failing: EmailProvider = { async send() { throw new Error("provider detail must not persist"); } };
    for (let attempt = 0; attempt < 8; attempt += 1) { const at = new Date(Date.now() + attempt * 2 * 60 * 60_000); await db.emailOutbox.updateMany({ where: { bookingId: booking.id }, data: { nextAttemptAt: at } }); await processEmailOutbox(owner.workspace.id, at, failing); }
    const row = await db.emailOutbox.findFirstOrThrow({ where: { bookingId: booking.id } }); expect(row).toMatchObject({ status: "DEAD", attemptCount: 8, lastErrorCode: "DELIVERY_FAILED" }); expect(JSON.stringify(row)).not.toContain("provider detail");
  });

  it("suppresses an authority exactly at its expiry boundary", async () => {
    const owner = await fixture("expiry-boundary"); await requestPasswordReset(owner.user.email);
    const token = await db.accountActionToken.findFirstOrThrow({ where: { userId: owner.user.id, purpose: "PASSWORD_RESET" } }); const provider = new CaptureProvider();
    await processEmailOutbox(owner.workspace.id, token.expiresAt, provider);
    expect(provider.messages).toHaveLength(0); expect(await db.emailOutbox.findFirst({ where: { workspaceId: owner.workspace.id } })).toMatchObject({ status: "SUPERSEDED", lastErrorCode: "AUTHORITY_NOT_CURRENT" });
  });
});
