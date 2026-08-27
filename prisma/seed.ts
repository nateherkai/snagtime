import { createRequire } from "node:module";
import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";

const require = createRequire(import.meta.url);
const { PrismaClient } = require("@prisma/client") as { PrismaClient: new () => { $disconnect: () => Promise<void> } & Record<string, unknown> };
const prisma = new PrismaClient();
const scrypt = promisify(scryptCallback);
async function seedPasswordHash(password: string) {
  if (password.length < 12 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password)) throw new Error("DEMO_HOST_PASSWORD must be strong.");
  const salt = randomBytes(16); const derived = await scrypt(password, salt, 32) as Buffer;
  return `scrypt:v1:${salt.toString("base64url")}:${derived.toString("base64url")}`;
}

async function main() {
  if (process.env.DEMO_MODE !== "true") throw new Error("Seed is allowed only with explicit DEMO_MODE=true.");
  const password = process.env.DEMO_HOST_PASSWORD;
  if (!password) throw new Error("DEMO_HOST_PASSWORD is required for the demo seed.");
  const passwordHash = await seedPasswordHash(password);
  const email = (process.env.DEMO_HOST_EMAIL || "nate@example.com").toLowerCase();
  const host = await prisma.user.upsert({
    where: { email },
    update: { passwordHash, emailVerifiedAt: new Date() },
    create: { email, name: "Nate Herk", timeZone: "America/Chicago", passwordHash, emailVerifiedAt: new Date() },
  });
  const workspace = await prisma.workspace.upsert({
    where: { id: `ws_${host.id}` },
    update: {},
    create: { id: `ws_${host.id}`, name: "Uppity AI", timeZone: host.timeZone, onboardingCompletedAt: new Date() },
  });
  await prisma.membership.upsert({
    where: { workspaceId_userId: { workspaceId: workspace.id, userId: host.id } },
    update: { role: "OWNER", status: "ACTIVE" },
    create: { id: `mem_${host.id}`, workspaceId: workspace.id, userId: host.id, role: "OWNER", status: "ACTIVE" },
  });

  await prisma.availabilitySchedule.upsert({
    where: { workspaceId_userId: { workspaceId: workspace.id, userId: host.id } },
    update: {},
    create: {
      workspaceId: workspace.id, userId: host.id,
      timeZone: host.timeZone,
      intervals: {
        create: [1, 2, 3, 4, 5].map((dayOfWeek) => ({ dayOfWeek, startMinute: 9 * 60, endMinute: 17 * 60 })),
      },
    },
  });

  const eventType = await prisma.eventType.upsert({
    where: { slug: "strategy-call" },
    update: {},
    create: {
      workspaceId: workspace.id, ownerId: host.id,
      name: "Strategy Call",
      slug: "strategy-call",
      description: "A focused conversation about your next best move.",
      durationMinutes: 30,
      color: "#2563EB",
      locationType: "CUSTOM",
      locationValue: "Organizer will share meeting details",
    },
  });
  if (!await prisma.eventDuration.count({ where: { eventTypeId: eventType.id } })) {
    await prisma.eventDuration.createMany({ data: [
      { eventTypeId: eventType.id, label: "30 minutes", durationMinutes: 30, isDefault: true, priceCents: 0, currency: "usd", position: 0 },
      { eventTypeId: eventType.id, label: "60 minutes", durationMinutes: 60, isDefault: false, priceCents: 0, currency: "usd", position: 1 },
    ] });
  }
  if (!await prisma.customQuestion.count({ where: { eventTypeId: eventType.id } })) {
    await prisma.customQuestion.create({ data: { eventTypeId: eventType.id, label: "What would make this call valuable?", kind: "TEXT", required: false, position: 0 } });
  }

  const paidSession = await prisma.eventType.upsert({
    where: { slug: "paid-strategy-session" },
    update: {
      name: "Revenue Strategy Session",
      description: "A focused working session for solo experts building a more reliable offer and booking flow.",
      locationType: "GOOGLE_MEET",
      minimumNoticeMinutes: 120,
      bookingWindowDays: 30,
      isActive: true,
    },
    create: {
      workspaceId: workspace.id,
      ownerId: host.id,
      name: "Revenue Strategy Session",
      slug: "paid-strategy-session",
      description: "A focused working session for solo experts building a more reliable offer and booking flow.",
      durationMinutes: 60,
      color: "#2563EB",
      locationType: "GOOGLE_MEET",
      minimumNoticeMinutes: 120,
      bookingWindowDays: 30,
    },
  });
  const paidDuration = await prisma.eventDuration.findFirst({ where: { eventTypeId: paidSession.id, label: "60 minutes" } });
  if (paidDuration) {
    await prisma.eventDuration.update({ where: { id: paidDuration.id }, data: { durationMinutes: 60, isDefault: true, priceCents: 14900, currency: "usd", position: 0, isActive: true } });
  } else {
    await prisma.eventDuration.create({ data: { eventTypeId: paidSession.id, label: "60 minutes", durationMinutes: 60, isDefault: true, priceCents: 14900, currency: "usd", position: 0 } });
  }
  if (!await prisma.customQuestion.count({ where: { eventTypeId: paidSession.id } })) {
    await prisma.customQuestion.createMany({ data: [
      { eventTypeId: paidSession.id, label: "What outcome would make this session valuable?", kind: "TEXTAREA", required: true, position: 0 },
      { eventTypeId: paidSession.id, label: "What do you currently use for booking and payment?", kind: "TEXT", required: false, position: 1 },
    ] });
  }
  await prisma.workspaceBranding.upsert({
    where: { workspaceId: workspace.id },
    update: {},
    create: { workspaceId: workspace.id, userId: host.id, workspaceName: "Uppity AI", accentColor: "#2563EB", description: "Book a focused conversation with Nate." },
  });
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
