import { describe, expect, it } from "vitest";
import { availabilitySaveResultIsCurrent, canMutateAvailability } from "./availability-editor-state";

describe("availability editor safety state", () => {
  it("permits mutations only after the initial availability load succeeds", () => {
    expect(canMutateAvailability("loading")).toBe(false);
    expect(canMutateAvailability("error")).toBe(false);
    expect(canMutateAvailability("loaded")).toBe(true);
  });

  it("does not apply an older save response over concurrent edits", () => {
    expect(availabilitySaveResultIsCurrent(3, 3)).toBe(true);
    expect(availabilitySaveResultIsCurrent(3, 4)).toBe(false);
  });
});
