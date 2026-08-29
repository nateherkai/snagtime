import { DateTime } from "luxon";
import type { AvailabilityInterval, AvailabilitySchedule, BookingSlot } from "@/lib/contracts";
import { db } from "@/server/db";
import { currentDatabaseContext, enterDatabaseAction, runWithDatabaseContext } from "@/server/db-context";

export type BusyInterval = { start: Date; end: Date };
export type SlotEventType = {
  durationId?: string;
  durationMinutes: number;
  priceCents?: number;
  currency?: string;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  minimumNoticeMinutes: number;
  bookingWindowDays: number;
};

export function mergeBusyIntervals(busy: BusyInterval[]): BusyInterval[] {
  const sorted = busy
    .filter((item) => Number.isFinite(item.start.getTime()) && Number.isFinite(item.end.getTime()) && item.end > item.start)
    .sort((left, right) => left.start.getTime() - right.start.getTime());
  const merged: BusyInterval[] = [];
  for (const item of sorted) {
    const prior = merged.at(-1);
    if (!prior || item.start > prior.end) merged.push({ start: item.start, end: item.end });
    else if (item.end > prior.end) prior.end = item.end;
  }
  return merged;
}

export function generateSlots({
  eventType, schedule, busy, from, to, now = new Date(), outputTimeZone,
}: {
  eventType: SlotEventType;
  schedule: AvailabilitySchedule;
  busy: BusyInterval[];
  from: Date;
  to: Date;
  now?: Date;
  outputTimeZone: string;
}): BookingSlot[] {
  const zone = schedule.timeZone;
  const rangeStart = DateTime.fromJSDate(from, { zone: "utc" });
  const rangeEnd = DateTime.fromJSDate(to, { zone: "utc" });
  const earliest = DateTime.fromJSDate(now, { zone: "utc" }).plus({ minutes: eventType.minimumNoticeMinutes });
  const latest = DateTime.fromJSDate(now, { zone: "utc" }).plus({ days: eventType.bookingWindowDays });
  const busyIntervals = mergeBusyIntervals(busy).map((item) => ({ start: item.start.getTime(), end: item.end.getTime() }));
  const overlapsBusy = (start: number, end: number) => {
    let low = 0; let high = busyIntervals.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (busyIntervals[middle]!.end <= start) low = middle + 1; else high = middle;
    }
    return low < busyIntervals.length && busyIntervals[low]!.start < end;
  };
  const slots: BookingSlot[] = [];
  let day = rangeStart.setZone(zone).startOf("day");
  const finalDay = rangeEnd.setZone(zone).endOf("day");

  while (day <= finalDay) {
    const dayOfWeek = day.weekday % 7;
    const dateKey = day.toFormat("yyyy-LL-dd");
    const dayOverrides = (schedule.overrides ?? []).filter((item) => item.dateKey === dateKey);
    const dayIntervals = dayOverrides.length
      ? dayOverrides.some((item) => !item.isAvailable) ? [] : dayOverrides.filter((item) => item.isAvailable && item.startMinute != null && item.endMinute != null).map((item) => ({ dayOfWeek, startMinute: item.startMinute!, endMinute: item.endMinute! }))
      : schedule.intervals.filter((item) => item.dayOfWeek === dayOfWeek);
    for (const availability of dayIntervals) {
      let cursor = day.plus({ minutes: availability.startMinute });
      const intervalEnd = day.plus({ minutes: availability.endMinute });
      while (cursor.plus({ minutes: eventType.durationMinutes }) <= intervalEnd) {
        const start = cursor.toUTC();
        const end = cursor.plus({ minutes: eventType.durationMinutes }).toUTC();
        const occupiedStart = start.minus({ minutes: eventType.bufferBeforeMinutes }).toMillis();
        const occupiedEnd = end.plus({ minutes: eventType.bufferAfterMinutes }).toMillis();
        if (start >= rangeStart && end <= rangeEnd && start >= earliest && start <= latest && !overlapsBusy(occupiedStart, occupiedEnd)) {
          slots.push({
            start: start.toISO()!,
            end: end.toISO()!,
            timeZone: outputTimeZone,
            durationId: eventType.durationId ?? "legacy-default",
            durationMinutes: eventType.durationMinutes,
            priceCents: eventType.priceCents ?? 0,
            currency: eventType.currency ?? "usd",
          });
        }
        cursor = cursor.plus({ minutes: 15 });
      }
    }
    day = day.plus({ days: 1 });
  }
  return slots;
}

export async function getAvailability(
  workspaceId: string,
  userId: string,
  trustedPublicTimeZone?: string,
  range?: { from: Date; to: Date },
): Promise<AvailabilitySchedule> {
  // Availability date keys are local-calendar values. Expanding a UTC range by
  // two days safely covers every IANA offset while allowing the composite index
  // to avoid loading years of unrelated overrides on public slot requests.
  const dateKey = range ? {
    gte: DateTime.fromJSDate(range.from, { zone: "utc" }).minus({ days: 2 }).toISODate()!,
    lte: DateTime.fromJSDate(range.to, { zone: "utc" }).plus({ days: 2 }).toISODate()!,
  } : undefined;
  const [overrides, schedule] = await Promise.all([
    db.availabilityOverride.findMany({ where: { workspaceId, userId, dateKey }, orderBy: [{ dateKey: "asc" }, { startMinute: "asc" }] }),
    db.availabilitySchedule.findUnique({ where: { workspaceId_userId: { workspaceId, userId } }, include: { intervals: true } }),
  ]);
  if (!schedule) {
    if (trustedPublicTimeZone) return { timeZone: trustedPublicTimeZone, intervals: [], overrides: overrides.map(({ id, dateKey, isAvailable, startMinute, endMinute }) => ({ id, dateKey, isAvailable, startMinute, endMinute })) };
    const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
    return { timeZone: user.timeZone, intervals: [], overrides: overrides.map(({ id, dateKey, isAvailable, startMinute, endMinute }) => ({ id, dateKey, isAvailable, startMinute, endMinute })) };
  }
  return {
    timeZone: schedule.timeZone,
    intervals: schedule.intervals.map(({ id, dayOfWeek, startMinute, endMinute }) => ({ id, dayOfWeek, startMinute, endMinute })),
    overrides: overrides.map(({ id, dateKey, isAvailable, startMinute, endMinute }) => ({ id, dateKey, isAvailable, startMinute, endMinute })),
  };
}

export async function setAvailability(workspaceId: string, userId: string, input: AvailabilitySchedule) {
  const current = currentDatabaseContext();
  return runWithDatabaseContext({
    mode: "workspace",
    workspaceId,
    userId,
    sessionHash: current?.sessionHash,
    subject: current?.subject,
    action: "availability_write",
  }, async () => {
    enterDatabaseAction("availability_write", { workspaceId, userId, sessionHash: current?.sessionHash, subject: current?.subject });
    await db.$transaction(async (tx) => {
      const schedule = await tx.availabilitySchedule.upsert({
        where: { workspaceId_userId: { workspaceId, userId } }, update: { timeZone: input.timeZone }, create: { workspaceId, userId, timeZone: input.timeZone },
      });
      await tx.availabilityInterval.deleteMany({ where: { scheduleId: schedule.id } });
      if (input.intervals.length) {
        await tx.availabilityInterval.createMany({ data: input.intervals.map((item) => ({
          scheduleId: schedule.id, dayOfWeek: item.dayOfWeek, startMinute: item.startMinute, endMinute: item.endMinute,
        })) });
      }
      await tx.availabilityOverride.deleteMany({ where: { workspaceId, userId } });
      if (input.overrides?.length) await tx.availabilityOverride.createMany({ data: input.overrides.map((item) => ({
        workspaceId, userId, dateKey: item.dateKey, isAvailable: item.isAvailable,
        startMinute: item.isAvailable ? item.startMinute : null, endMinute: item.isAvailable ? item.endMinute : null,
      })) });
    });
    await runWithDatabaseContext({
      mode: "workspace",
      workspaceId,
      userId,
      sessionHash: currentDatabaseContext()?.sessionHash,
      subject: currentDatabaseContext()?.subject,
      action: "account_write",
    }, async () => {
      await db.user.update({ where: { id: userId }, data: { timeZone: input.timeZone } });
    });
    return getAvailability(workspaceId, userId);
  });
}

export function stripIntervalIds(intervals: AvailabilityInterval[]) {
  return intervals.map(({ dayOfWeek, startMinute, endMinute }) => ({ dayOfWeek, startMinute, endMinute }));
}
