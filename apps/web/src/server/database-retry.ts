import { AsyncLocalStorage } from "node:async_hooks";
import { AppError } from "@/server/errors";

const RETRY_DEADLINE_MS = 20_000;
const MAX_RETRY_DELAY_MS = 250;
function databaseBusy() { return new AppError("DATABASE_TRANSACTION_RETRY", "The booking database is busy. Retry the same request.", 503); }

function errorText(error: unknown) {
  if (!error || typeof error !== "object") return "";
  const candidate = error as { message?: unknown; meta?: { error?: unknown } };
  return `${String(candidate.message ?? "")} ${String(candidate.meta?.error ?? "")}`;
}

export function isRetryableDatabaseTransactionError(error: unknown) {
  const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
  if (code === "P2034") return true;
  return code === "P2028" && /\bUnable to (?:start|acquire) (?:a )?transaction\b/i.test(errorText(error));
}

type TransactionBudget = { deadline: number; now: () => number };
const transactionBudget = new AsyncLocalStorage<TransactionBudget>();
export function currentDatabaseTransactionBudgetMs() {
  const budget = transactionBudget.getStore();
  return budget ? Math.max(0, budget.deadline - budget.now()) : undefined;
}

export function boundedPrismaTransactionOptions(remainingMs: number, requested: { maxWait?: number; timeout?: number } = {}) {
  const budget = Math.floor(remainingMs);
  if (budget < 2) throw databaseBusy();
  const maxWait = Math.max(1, Math.min(requested.maxWait ?? 15_000, budget - 1));
  const timeout = Math.max(1, Math.min(requested.timeout ?? 30_000, budget - maxWait));
  return { maxWait, timeout };
}

type RetryOptions = {
  deadlineMs?: number;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
};

export async function withDatabaseTransactionRetry<T>(operation: (remainingMs: number) => Promise<T>, options: RetryOptions = {}) {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const deadline = now() + (options.deadlineMs ?? RETRY_DEADLINE_MS);
  let attempt = 0;
  for (;;) {
    const beforeAttempt = deadline - now();
    if (beforeAttempt <= 0) throw databaseBusy();
    try { return await transactionBudget.run({ deadline, now }, () => operation(beforeAttempt)); }
    catch (error) {
      if (!isRetryableDatabaseTransactionError(error)) throw error;
      const afterAttempt = deadline - now();
      if (afterAttempt <= 0) throw databaseBusy();
      const delay = Math.min(MAX_RETRY_DELAY_MS, 25 * 2 ** Math.min(attempt++, 3), afterAttempt);
      await sleep(delay);
      if (deadline - now() <= 0) throw databaseBusy();
    }
  }
}
