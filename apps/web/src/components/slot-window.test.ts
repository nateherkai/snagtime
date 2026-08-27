import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BookingSlot } from "@/lib/contracts";
import { frontendApi } from "./api-adapter";
import { loadBookingWindowSlots, loadRescheduleWindowSlots } from "./slot-window";

vi.mock("./api-adapter", () => ({
  frontendApi: {
    getSlots: vi.fn(),
    getRescheduleSlots: vi.fn(),
  },
}));

const getSlots = vi.mocked(frontendApi.getSlots);
const getRescheduleSlots = vi.mocked(frontendApi.getRescheduleSlots);
function slot(start: string): BookingSlot { return { start, end: new Date(new Date(start).getTime() + 30 * 60_000).toISOString(), timeZone: "UTC", durationId: "duration", durationMinutes: 30, priceCents: 0, currency: "USD" }; }

describe("slot window loading", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-24T12:00:00.000Z"));
    getSlots.mockReset();
    getRescheduleSlots.mockReset();
  });

  afterEach(() => vi.useRealTimers());

  it("loads booking chunks concurrently and returns stable deduplicated order", async () => {
    const pending: Array<(value: BookingSlot[]) => void> = [];
    getSlots.mockImplementation(() => new Promise((resolve) => pending.push(resolve)));

    const result = loadBookingWindowSlots("strategy", 60, "UTC", "duration");
    expect(getSlots).toHaveBeenCalledTimes(2);

    pending[1]!([slot("2026-09-25T10:00:00.000Z")]);
    pending[0]!([
      slot("2026-08-25T10:00:00.000Z"),
      slot("2026-09-25T10:00:00.000Z"),
    ]);

    await expect(result).resolves.toEqual([
      slot("2026-08-25T10:00:00.000Z"),
      slot("2026-09-25T10:00:00.000Z"),
    ]);
  });

  it("propagates cancellation to every in-flight reschedule chunk", async () => {
    getRescheduleSlots.mockImplementation((_id, _from, _to, _zone, _duration, signal) => new Promise((_resolve, reject) => {
      signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
    }));
    const controller = new AbortController();
    const result = loadRescheduleWindowSlots("booking", 60, "UTC", "duration", controller.signal);
    expect(getRescheduleSlots).toHaveBeenCalledTimes(2);

    controller.abort();
    await expect(result).rejects.toMatchObject({ name: "AbortError" });
  });

  it("aborts sibling requests and does not schedule later chunks after one fails", async () => {
    getSlots.mockImplementation(() => {
      if (getSlots.mock.calls.length === 1) return Promise.reject(new Error("slot provider failed"));
      return Promise.resolve([]);
    });
    await expect(loadBookingWindowSlots("strategy", 120, "UTC", "duration")).rejects.toThrow("slot provider failed");
    expect(getSlots).toHaveBeenCalledTimes(3);
  });
});
