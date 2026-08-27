import { describe, expect, it } from "vitest";
import { assertCompiledBuildIdentity } from "@/server/build-identity";

describe("compiled build identity", () => {
  const exact = "a".repeat(40);
  it("accepts only an exact runtime-to-artifact identity", () => expect(assertCompiledBuildIdentity(exact, exact)).toBe(exact));
  it("rejects an omitted runtime identity", () => expect(() => assertCompiledBuildIdentity(undefined, exact)).toThrow(/immutable compiled/));
  it("rejects an omitted compiled identity", () => expect(() => assertCompiledBuildIdentity(exact, "development")).toThrow(/immutable compiled/));
  it("rejects a runtime identity substitution", () => expect(() => assertCompiledBuildIdentity("b".repeat(40), exact)).toThrow(/immutable compiled/));
});
