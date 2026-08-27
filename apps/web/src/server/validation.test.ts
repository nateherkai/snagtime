import { describe, expect, it } from "vitest";
import { availabilityInput, bookingInput, brandingInput, eventTypeInput, profileImageInput } from "@/server/validation";
import { IMAGE_DATA_URL_MAX_CHARS } from "@/server/image-ingestion";

describe("public input validation", () => {
  it("rejects overlapping weekly windows", () => {
    expect(() => availabilityInput.parse({ timeZone: "UTC", intervals: [
      { dayOfWeek: 1, startMinute: 540, endMinute: 600 },
      { dayOfWeek: 1, startMinute: 590, endMinute: 660 },
    ] })).toThrow(/overlap/);
  });

  it("rejects available hours mixed with a full-day unavailable override", () => {
    expect(() => availabilityInput.parse({ timeZone: "UTC", intervals: [], overrides: [
      { dateKey: "2026-08-24", isAvailable: false },
      { dateKey: "2026-08-24", isAvailable: true, startMinute: 540, endMinute: 600 },
    ] })).toThrow(/full-day unavailable/);
  });

  it("normalizes invitee email and rejects malformed booking input", () => {
    const parsed = bookingInput.parse({ startAt: "2026-08-24T14:00:00.000Z", inviteeName: "Ada Lovelace", inviteeEmail: "ADA@EXAMPLE.COM", inviteeTimeZone: "UTC" });
    expect(parsed.inviteeEmail).toBe("ada@example.com");
    expect(() => bookingInput.parse({ ...parsed, inviteeTimeZone: "Not/AZone" })).toThrow(/IANA/);
  });

  it("requires safe public booking slugs and testable pricing", () => {
    const base = { name: "Strategy Call", slug: "strategy-call", description: null, durationMinutes: 30, color: "#2563EB", locationType: "GOOGLE_MEET", locationValue: null, isActive: true, bufferBeforeMinutes: 0, bufferAfterMinutes: 0, minimumNoticeMinutes: 120, bookingWindowDays: 60, priceCents: 0, currency: "usd" };
    expect(eventTypeInput.parse(base).slug).toBe("strategy-call");
    expect(() => eventTypeInput.parse({ ...base, slug: "Bad Slug" })).toThrow(/lowercase/);
    expect(() => eventTypeInput.parse({ ...base, durations: [
      { label: "30 min", durationMinutes: 30, isDefault: true, priceCents: 0, currency: "usd", position: 0 },
      { label: "60 min", durationMinutes: 60, isDefault: true, priceCents: 0, currency: "usd", position: 1 },
    ] })).toThrow(/Exactly one/);
  });

  it("bounds image candidates and leaves decoding plus legacy preservation to the ingestion service", () => {
    const base = { workspaceName: "Example Workspace", accentColor: "#2563EB", description: null, footerText: null };
    const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
    expect(brandingInput.parse({ ...base, logoUrl: png }).logoUrl).toBe(png);
    expect(brandingInput.parse({ ...base, logoUrl: "https://example.com/legacy-logo.png" }).logoUrl).toBe("https://example.com/legacy-logo.png");
    expect(profileImageInput.parse({ imageUrl: png })).toEqual({ imageUrl: png });
    expect(() => profileImageInput.parse({ imageUrl: "a".repeat(IMAGE_DATA_URL_MAX_CHARS + 1) })).toThrow();
    expect(() => profileImageInput.parse({ imageUrl: null, userId: "someone-else" })).toThrow();
  });
});
