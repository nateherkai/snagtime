import { describe, expect, it } from "vitest";
import { retainBookingRecoveryAuthority, shareBookingRecoveryLoad } from "./booking-recovery-load";

describe("booking recovery Strict Mode load", () => {
  it("retains the claimed fragment authority for the second Strict Mode effect pass", () => {
    const retained = { current: "" };
    expect(retainBookingRecoveryAuthority(retained, () => "recovery-authority")).toBe("recovery-authority");
    expect(retainBookingRecoveryAuthority(retained, () => "")).toBe("recovery-authority");
  });

  it("makes both effect passes await the exchange before the authoritative GET", async () => {
    let exchangeComplete = false;
    let loads = 0;
    let prematureGets = 0;
    const authoritativeGet = () => { if (!exchangeComplete) prematureGets += 1; };
    const load = async () => {
      loads += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      exchangeComplete = true;
      authoritativeGet();
    };

    const first = shareBookingRecoveryLoad("booking\0recovery", load);
    const strictReplay = shareBookingRecoveryLoad("booking\0recovery", load);
    await Promise.all([first.promise, strictReplay.promise]);

    expect(strictReplay.promise).toBe(first.promise);
    expect(loads).toBe(1);
    expect(prematureGets).toBe(0);
  });
});
