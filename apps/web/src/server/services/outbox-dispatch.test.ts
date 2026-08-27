import { describe, expect, it } from "vitest";
import { shouldDrainOutboxInline } from "./outbox-dispatch";

describe("outbox request dispatch", () => {
  it("never enables inline delivery in production", () => {
    expect(shouldDrainOutboxInline("production", "true")).toBe(false);
    expect(shouldDrainOutboxInline("production", "false")).toBe(false);
  });

  it("keeps explicit test and local compatibility without changing production", () => {
    expect(shouldDrainOutboxInline("test")).toBe(true);
    expect(shouldDrainOutboxInline("development", "true")).toBe(true);
    expect(shouldDrainOutboxInline("development", "false")).toBe(false);
  });
});
