import { describe, expect, it } from "vitest";
import { generateSlots, mergeBusyIntervals } from "@/server/services/availability";

const eventType = {
  durationMinutes: 30,
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 0,
  minimumNoticeMinutes: 0,
  bookingWindowDays: 30,
};

describe("availability slot generation", () => {
  it("normalizes overlapping busy ranges once without changing boundary semantics", () => {
    expect(mergeBusyIntervals([
      { start: new Date("2026-08-24T10:15:00Z"), end: new Date("2026-08-24T10:45:00Z") },
      { start: new Date("2026-08-24T10:00:00Z"), end: new Date("2026-08-24T10:30:00Z") },
      { start: new Date("2026-08-24T10:45:00Z"), end: new Date("2026-08-24T11:00:00Z") },
      { start: new Date("invalid"), end: new Date("2026-08-24T12:00:00Z") },
    ])).toEqual([{ start: new Date("2026-08-24T10:00:00Z"), end: new Date("2026-08-24T11:00:00Z") }]);
  });

  it("expands weekly availability into deterministic UTC slots", () => {
    const slots = generateSlots({
      eventType,
      schedule: { timeZone: "America/Chicago", intervals: [{ dayOfWeek: 1, startMinute: 9 * 60, endMinute: 10 * 60 }] },
      busy: [],
      from: new Date("2026-08-24T00:00:00.000Z"),
      to: new Date("2026-08-25T00:00:00.000Z"),
      now: new Date("2026-08-20T00:00:00.000Z"),
      outputTimeZone: "America/New_York",
    });
    expect(slots.map((slot) => slot.start)).toEqual([
      "2026-08-24T14:00:00.000Z",
      "2026-08-24T14:15:00.000Z",
      "2026-08-24T14:30:00.000Z",
    ]);
    expect(slots.every((slot) => slot.timeZone === "America/New_York")).toBe(true);
  });

  it("removes overlaps including configured buffers", () => {
    const slots = generateSlots({
      eventType: { ...eventType, bufferBeforeMinutes: 15, bufferAfterMinutes: 15 },
      schedule: { timeZone: "UTC", intervals: [{ dayOfWeek: 1, startMinute: 9 * 60, endMinute: 11 * 60 }] },
      busy: [{ start: new Date("2026-08-24T10:00:00.000Z"), end: new Date("2026-08-24T10:30:00.000Z") }],
      from: new Date("2026-08-24T00:00:00.000Z"),
      to: new Date("2026-08-25T00:00:00.000Z"),
      now: new Date("2026-08-20T00:00:00.000Z"),
      outputTimeZone: "UTC",
    });
    expect(slots.map((slot) => slot.start)).toEqual(["2026-08-24T09:00:00.000Z", "2026-08-24T09:15:00.000Z"]);
  });

  it("uses date overrides and honors time off instead of weekly hours", () => {
    const slots = generateSlots({
      eventType,
      schedule: { timeZone: "UTC", intervals: [{ dayOfWeek: 1, startMinute: 540, endMinute: 600 }], overrides: [
        { dateKey: "2026-08-24", isAvailable: false },
        { dateKey: "2026-08-25", isAvailable: true, startMinute: 600, endMinute: 630 },
      ] },
      busy: [], from: new Date("2026-08-24T00:00:00Z"), to: new Date("2026-08-26T00:00:00Z"),
      now: new Date("2026-08-20T00:00:00Z"), outputTimeZone: "UTC",
    });
    expect(slots.map((slot) => slot.start)).toEqual(["2026-08-25T10:00:00.000Z"]);
  });
});
