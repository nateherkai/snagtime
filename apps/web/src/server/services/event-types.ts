import type { CreateEventTypeInput, UpdateEventTypeInput } from "@/lib/contracts";
import { db } from "@/server/db";
import { conflict, notFound } from "@/server/errors";
import { mapEventType } from "@/server/mappers";
import { assertPaidBookingsConfigured } from "@/server/services/payments";
import { googleCalendarReady } from "@/server/services/calendar";
import { enterDatabaseAction, enterPublicDatabaseContext } from "@/server/db-context";

const includeOptions = { durations: { where: { isActive: true }, orderBy: { position: "asc" as const } }, questions: { where: { isActive: true }, orderBy: { position: "asc" as const } }, owner: { select: { name: true, timeZone: true } }, workspace: { select: { branding: true } }, _count: { select: { bookings: true } } };
const slotOptions = { durations: { where: { isActive: true }, orderBy: { position: "asc" as const } }, owner: { select: { timeZone: true } } };

export async function listEventTypes(workspaceId: string) {
  return (await db.eventType.findMany({ where: { workspaceId }, include: includeOptions, orderBy: { createdAt: "desc" } })).map(mapEventType);
}

export async function getEventTypeBySlug(slug: string, activeOnly = true) {
  enterPublicDatabaseContext(slug);
  const eventType = await db.eventType.findUnique({ where: { slug }, include: includeOptions });
  if (!eventType || (activeOnly && !eventType.isActive)) throw notFound("Event type");
  enterPublicDatabaseContext(slug, eventType.workspaceId, eventType.id);
  return eventType;
}

export async function getEventTypeForSlotsBySlug(slug: string, activeOnly = true) {
  enterPublicDatabaseContext(slug);
  const eventType = await db.eventType.findUnique({ where: { slug }, include: slotOptions });
  if (!eventType || (activeOnly && !eventType.isActive)) throw notFound("Event type");
  enterPublicDatabaseContext(slug, eventType.workspaceId, eventType.id);
  return eventType;
}

export async function getEventTypeById(workspaceId: string, id: string) {
  const eventType = await db.eventType.findFirst({ where: { id, workspaceId }, include: includeOptions });
  if (!eventType) throw notFound("Event type");
  return mapEventType(eventType);
}

function normalizedDurations(input: CreateEventTypeInput) {
  return input.durations?.length ? input.durations : [{
    label: `${input.durationMinutes} min`, durationMinutes: input.durationMinutes, isDefault: true,
    priceCents: input.priceCents, currency: input.currency, position: 0,
  }];
}

type CalendarReadiness = (userId: string, workspaceId?: string) => Promise<boolean>;
async function assertLocationReady(workspaceId: string, ownerId: string, locationType: string, isActive: boolean, readiness: CalendarReadiness = googleCalendarReady) {
  if (!isActive || locationType !== "GOOGLE_MEET") return;
  if (!await readiness(ownerId, workspaceId)) {
    throw conflict("Connect an active Google Calendar account before publishing a Google Meet event.");
  }
}

export async function createEventType(workspaceId: string, ownerId: string, input: CreateEventTypeInput) {
  enterDatabaseAction("event_write", { workspaceId, userId: ownerId });
  if (await db.eventType.findUnique({ where: { slug: input.slug } })) throw conflict("That booking link is already in use.");
  const durations = normalizedDurations(input).map((item) => ({
    label: item.label, durationMinutes: item.durationMinutes, isDefault: item.isDefault,
    priceCents: item.priceCents, currency: item.currency, position: item.position,
  }));
  if (input.isActive && durations.some((item) => item.priceCents > 0)) assertPaidBookingsConfigured();
  await assertLocationReady(workspaceId, ownerId, input.locationType, input.isActive);
  const { durations: ignoredDurations, questions, ...eventData } = input;
  void ignoredDurations;
  const created = await db.eventType.create({ data: {
    ...eventData, workspaceId, ownerId,
    durations: { create: durations },
    questions: { create: (questions ?? []).map(({ id: ignoredId, options, ...item }) => { void ignoredId; return { ...item, optionsJson: JSON.stringify(options) }; }) },
  }, include: includeOptions });
  return mapEventType(created);
}

export async function updateEventType(workspaceId: string, _actingUserId: string, id: string, input: UpdateEventTypeInput, readiness: CalendarReadiness = googleCalendarReady) {
  enterDatabaseAction("event_write", { workspaceId, userId: _actingUserId });
  const current = await db.eventType.findFirst({ where: { id, workspaceId }, include: includeOptions });
  if (!current) throw notFound("Event type");
  if (input.slug && input.slug !== current.slug && await db.eventType.findUnique({ where: { slug: input.slug } })) throw conflict("That booking link is already in use.");
  const candidateDurations = input.durations ?? current.durations;
  if ((input.isActive ?? current.isActive) && candidateDurations.some((item) => item.priceCents > 0)) assertPaidBookingsConfigured();
  await assertLocationReady(workspaceId, current.ownerId, input.locationType ?? current.locationType, input.isActive ?? current.isActive, readiness);
  const { durations, questions, ...eventData } = input;
  return mapEventType(await db.$transaction(async (tx) => {
    if (durations) {
      const suppliedIds = durations.flatMap((item) => item.id ? [item.id] : []);
      const ownedIds = await tx.eventDuration.findMany({ where: { eventTypeId: id, id: { in: suppliedIds } }, select: { id: true } });
      if (ownedIds.length !== suppliedIds.length) throw conflict("A duration option does not belong to this event type.");
      await tx.eventDuration.updateMany({ where: { eventTypeId: id }, data: { isDefault: false } });
      await tx.eventDuration.updateMany({ where: { eventTypeId: id, id: { notIn: suppliedIds } }, data: { isActive: false } });
      for (const duration of durations) {
        const { id: durationId, ...data } = duration;
        if (durationId) await tx.eventDuration.update({ where: { id: durationId }, data: { ...data, isActive: true } });
        else await tx.eventDuration.create({ data: { ...data, eventTypeId: id, isActive: true } });
      }
    }
    if (questions) {
      const suppliedIds = questions.flatMap((item) => item.id ? [item.id] : []);
      const ownedIds = await tx.customQuestion.findMany({ where: { eventTypeId: id, id: { in: suppliedIds } }, select: { id: true } });
      if (ownedIds.length !== suppliedIds.length) throw conflict("A custom question does not belong to this event type.");
      await tx.customQuestion.updateMany({ where: { eventTypeId: id, id: { notIn: suppliedIds } }, data: { isActive: false } });
      for (const question of questions) {
        const { id: questionId, options, ...data } = question; const stored = { ...data, optionsJson: JSON.stringify(options), isActive: true };
        if (questionId) await tx.customQuestion.update({ where: { id: questionId }, data: stored });
        else await tx.customQuestion.create({ data: { ...stored, eventTypeId: id } });
      }
    }
    return tx.eventType.update({ where: { id }, data: eventData, include: includeOptions });
  }));
}

export async function deleteEventType(workspaceId: string, id: string, userId?: string) {
  enterDatabaseAction("event_write", { workspaceId, userId });
  const current = await db.eventType.findFirst({ where: { id, workspaceId } });
  if (!current) throw notFound("Event type");
  if (await db.booking.count({ where: { eventTypeId: id } })) await db.eventType.update({ where: { id }, data: { isActive: false } });
  else await db.eventType.delete({ where: { id } });
}
