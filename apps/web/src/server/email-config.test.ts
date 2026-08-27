import { afterEach, describe, expect, it, vi } from "vitest";
import { systemEmailIdentity } from "./email-config";

describe("system email identity", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("canonicalizes one approved sender address", () => {
    vi.stubEnv("EMAIL_FROM", "SnagTime <notifications@snagtime.com>");
    vi.stubEnv("EMAIL_REPLY_TO", "support@snagtime.com");
    vi.stubEnv("EMAIL_SENDER_DOMAIN", "snagtime.com");
    expect(systemEmailIdentity()).toEqual({ from: "SnagTime <notifications@snagtime.com>", fromMailbox: "notifications@snagtime.com", replyTo: "support@snagtime.com", senderDomain: "snagtime.com" });
  });

  it.each([
    "attacker@example.net, SnagTime <notifications@snagtime.com>",
    '"Attacker" <attacker@example.net>, SnagTime <notifications@snagtime.com>',
    "SnagTime <notifications@snagtime.com>, attacker@example.net",
  ])("rejects multiple or injected From identities: %s", (from) => {
    vi.stubEnv("EMAIL_FROM", from);
    vi.stubEnv("EMAIL_REPLY_TO", "support@snagtime.com");
    vi.stubEnv("EMAIL_SENDER_DOMAIN", "snagtime.com");
    expect(() => systemEmailIdentity()).toThrow("SMTP_MAILBOX_INVALID");
  });
});
