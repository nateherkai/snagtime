import { beforeEach, describe, expect, it } from "vitest";
import type { CreateBookingInput } from "@/lib/contracts";
import { getBookingAttempt, rememberBookingAttempt } from "./booking-attempt";

const values = new Map<string, string>();
const storage = {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => { values.set(key, value); },
  removeItem: (key: string) => { values.delete(key); },
};

describe("booking attempt browser storage", () => {
  beforeEach(() => {
    values.clear();
    Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: storage });
  });

  it("reuses an identical attempt without persisting invitee input", async () => {
    const input: CreateBookingInput = { startAt: "2026-09-01T15:00:00.000Z", inviteeName: "Synthetic Invitee", inviteeEmail: "synthetic@example.test", inviteeTimeZone: "UTC", notes: "private note", answers: [{ questionId: "q1", value: "private answer" }] };
    const first = await getBookingAttempt("strategy-call", input);
    const second = await getBookingAttempt("strategy-call", input);
    rememberBookingAttempt("strategy-call", "booking-1");
    const serialized = [...values.values()].join("\n");

    expect(second.key).toBe(first.key);
    expect(serialized).toContain("booking-1");
    expect(serialized).not.toContain(input.inviteeName);
    expect(serialized).not.toContain(input.inviteeEmail);
    expect(serialized).not.toContain(input.notes);
    expect(serialized).not.toContain("private answer");
  });
});
