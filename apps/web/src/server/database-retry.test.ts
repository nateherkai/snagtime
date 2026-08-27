import { describe, expect, it } from "vitest";
import { boundedPrismaTransactionOptions, withDatabaseTransactionRetry } from "@/server/database-retry";

function prismaError(code: string, message: string) { return Object.assign(new Error(message), { code }); }

describe("database transaction retry", () => {
  it("shares the remaining wall budget between acquisition and transaction execution", () => {
    expect(boundedPrismaTransactionOptions(20_000)).toEqual({ maxWait: 15_000, timeout: 5_000 });
    const final = boundedPrismaTransactionOptions(7);
    expect(final.maxWait + final.timeout).toBeLessThanOrEqual(7);
  });

  it.each([0, 1])("fails closed before constructing Prisma options for a %ims budget", (remainingMs) => {
    expect(() => boundedPrismaTransactionOptions(remainingMs)).toThrow(expect.objectContaining({ code: "DATABASE_TRANSACTION_RETRY", status: 503 }));
  });
  it("retries a recognized P2028 acquisition failure and returns the successful result", async () => {
    let attempts = 0;
    await expect(withDatabaseTransactionRetry(async () => {
      if (attempts++ === 0) throw prismaError("P2028", "Transaction API error: Unable to start a transaction in the given time.");
      return "winner";
    }, { sleep: async () => undefined })).resolves.toBe("winner");
    expect(attempts).toBe(2);
  });

  it("keeps persistent acquisition failure inside the wall deadline and starts no attempt at the deadline", async () => {
    let clock = 0; const starts: number[] = []; const budgets: number[] = [];
    await expect(withDatabaseTransactionRetry(async (remainingMs) => {
      starts.push(clock); budgets.push(remainingMs);
      throw prismaError("P2028", "Unable to start a transaction in the given time.");
    }, { deadlineMs: 20_000, now: () => clock, sleep: async (milliseconds) => { clock += milliseconds; } })).rejects.toMatchObject({ code: "DATABASE_TRANSACTION_RETRY", status: 503 });
    expect(clock).toBeLessThanOrEqual(20_000); expect(starts.every((start) => start < 20_000)).toBe(true); expect(budgets.every((budget) => budget > 0 && budget <= 20_000)).toBe(true);
  });

  it("does not retry unrelated transaction or authorization errors", async () => {
    let attempts = 0;
    await expect(withDatabaseTransactionRetry(async () => { attempts += 1; throw prismaError("P2028", "Transaction already closed."); }, { sleep: async () => undefined })).rejects.toThrow(/already closed/);
    expect(attempts).toBe(1);
  });

  it("does not retry an expired transaction P2028 even when its text mentions timeout", async () => {
    let attempts = 0;
    await expect(withDatabaseTransactionRetry(async () => { attempts += 1; throw prismaError("P2028", "Transaction expired: timeout elapsed and transaction already closed."); }, { sleep: async () => undefined })).rejects.toThrow(/expired/);
    expect(attempts).toBe(1);
  });

  it("retries P2034 serialization failure and returns the successful result", async () => {
    let attempts = 0;
    await expect(withDatabaseTransactionRetry(async () => {
      if (attempts++ === 0) throw prismaError("P2034", "Transaction failed due to a write conflict or a deadlock.");
      return "serialized-winner";
    }, { sleep: async () => undefined })).resolves.toBe("serialized-winner");
    expect(attempts).toBe(2);
  });

  it("maps persistent P2034 to the typed retryable error within the deadline", async () => {
    let clock = 0; const starts: number[] = [];
    await expect(withDatabaseTransactionRetry(async () => {
      starts.push(clock); throw prismaError("P2034", "Transaction failed due to a write conflict or a deadlock.");
    }, { deadlineMs: 20_000, now: () => clock, sleep: async (milliseconds) => { clock += milliseconds; } })).rejects.toMatchObject({ code: "DATABASE_TRANSACTION_RETRY", status: 503 });
    expect(clock).toBeLessThanOrEqual(20_000); expect(starts.every((start) => start < 20_000)).toBe(true);
  });
});
