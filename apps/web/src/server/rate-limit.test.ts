import { beforeEach, describe, expect, it } from "vitest";
import { clientAddress, enforceRateLimit, rateLimitCounterCountForTest, rateLimitMaximumCountersForTest, resetRateLimitsForTest } from "@/server/rate-limit";
import { GET as getPublicEvent } from "@/app/api/public/[slug]/route";
import { GET as getManagedBooking } from "@/app/api/bookings/[id]/route";
import { GET as getManagedSlots } from "@/app/api/bookings/[id]/slots/route";
import { manageCookieName } from "@/server/auth/capabilities";

describe("POC rate limiting", () => {
  beforeEach(resetRateLimitsForTest);
  it("allows the bound then fails closed until the window resets", async () => {
    await enforceRateLimit("invitee", 2, 1000, 0);
    await enforceRateLimit("invitee", 2, 1000, 1);
    await expect(enforceRateLimit("invitee", 2, 1000, 2)).rejects.toThrow(/Too many/);
    await expect(enforceRateLimit("invitee", 2, 1000, 1000)).resolves.toBeUndefined();
  });
  it("ignores spoofed forwarding headers unless proxy trust is explicit", () => {
    delete process.env.TRUST_PROXY;
    const request = new Request("http://localhost", { headers: { "x-forwarded-for": "203.0.113.7" } });
    expect(clientAddress(request)).toBe("anonymous-local");
    process.env.TRUST_PROXY = "true"; process.env.PROXY_SHARED_SECRET = "proxy-test-secret-that-is-at-least-thirty-two-bytes";
    expect(clientAddress(request)).toBe("global-untrusted-proxy");
    const authenticated = new Request("http://localhost", { headers: { "x-forwarded-for": "203.0.113.7", "x-tempocove-proxy-secret": process.env.PROXY_SHARED_SECRET } });
    expect(clientAddress(authenticated)).toBe("203.0.113.7");
    delete process.env.TRUST_PROXY; delete process.env.PROXY_SHARED_SECRET;
  });
  it("evicts expired counter keys instead of growing forever", async () => {
    for (let index = 0; index < 99; index += 1) await enforceRateLimit(`expired-${index}`, 1, 1, 0);
    await enforceRateLimit("current", 1, 1000, 2);
    expect(rateLimitCounterCountForTest()).toBe(1);
  });
  it("hard-bounds adversarial counter cardinality", async () => {
    for (let index = 0; index < rateLimitMaximumCountersForTest + 50; index += 1) await enforceRateLimit(`attacker-${index}`, 1, 60_000, 0);
    expect(rateLimitCounterCountForTest()).toBe(rateLimitMaximumCountersForTest);
  });
  it("rejects public event reads before resolving a slug after the coarse IP budget",async()=>{
    for(let index=0;index<120;index+=1)await enforceRateLimit("public-event:ip:anonymous-local",120,60_000);
    const response=await getPublicEvent(new Request("http://localhost:3000/api/public/not-resolved"),{params:Promise.resolve({slug:"not-resolved"})});
    expect(response.status).toBe(429);expect(await response.json()).toEqual({error:{code:"RATE_LIMITED",message:"Too many requests. Try again shortly."}});
  });
  it("shares one coarse IP budget across invalid manage detail and slot authorization",async()=>{
    for(let index=0;index<240;index+=1)await enforceRateLimit("manage-attempt:ip:anonymous-local",240,60_000);
    const id="not-resolved",request=new Request(`http://localhost:3000/api/bookings/${id}`,{headers:{cookie:`${manageCookieName(id)}=malformed-authority`}}),context={params:Promise.resolve({id})};
    const [detail,slots]=await Promise.all([getManagedBooking(request,context),getManagedSlots(request,context)]);
    expect(detail.status).toBe(429);expect(slots.status).toBe(429);
  });
});
