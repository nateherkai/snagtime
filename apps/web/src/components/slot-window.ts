import type { BookingSlot } from "@/lib/contracts";
import { frontendApi } from "./api-adapter";

const dayMilliseconds = 24 * 60 * 60 * 1000;
const chunkDays = 31;
const maxConcurrentChunks = 3;

type SlotRange = { from: string; to: string };
type SlotRequest = (range: SlotRange, signal?: AbortSignal) => Promise<BookingSlot[]>;

function bookingWindowRanges(bookingWindowDays: number, now = new Date()): SlotRange[] {
  const end = new Date(now.getTime() + Math.max(1, bookingWindowDays) * dayMilliseconds);
  const ranges: SlotRange[] = [];
  for (let cursor = now; cursor < end;) {
    const chunkEnd = new Date(Math.min(cursor.getTime() + chunkDays * dayMilliseconds, end.getTime()));
    ranges.push({ from: cursor.toISOString(), to: chunkEnd.toISOString() });
    cursor = chunkEnd;
  }
  return ranges;
}

function aborted(signal?: AbortSignal) {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new DOMException("The slot request was superseded.", "AbortError");
}

async function loadRanges(ranges: SlotRange[], request: SlotRequest, signal?: AbortSignal) {
  const controller = new AbortController();
  const forwardAbort = () => controller.abort(signal?.reason);
  if (signal?.aborted) forwardAbort();
  else signal?.addEventListener("abort", forwardAbort, { once: true });
  const chunks: BookingSlot[][] = new Array(ranges.length);
  let nextIndex = 0;
  let failed = false;
  async function worker() {
    for (;;) {
      if (failed) return;
      aborted(controller.signal);
      const index = nextIndex++;
      if (index >= ranges.length) return;
      try { chunks[index] = await request(ranges[index]!, controller.signal); }
      catch (reason) { failed = true; controller.abort(reason); throw reason; }
    }
  }
  const workers = Array.from({ length: Math.min(maxConcurrentChunks, ranges.length) }, () => worker());
  try { await Promise.all(workers); }
  catch (reason) { controller.abort(reason); await Promise.allSettled(workers); throw reason; }
  finally { signal?.removeEventListener("abort", forwardAbort); }
  aborted(controller.signal);
  return [...new Map(chunks.flat().map((slot) => [`${slot.start}:${slot.durationId}`, slot])).values()]
    .sort((left, right) => left.start.localeCompare(right.start) || String(left.durationId).localeCompare(String(right.durationId)));
}

export async function loadBookingWindowSlots(slug: string, bookingWindowDays: number, timeZone: string, durationId?: string, signal?: AbortSignal) {
  return loadRanges(bookingWindowRanges(bookingWindowDays), (range, activeSignal) => frontendApi.getSlots(slug, range.from, range.to, timeZone, durationId, activeSignal), signal);
}

export async function loadRescheduleWindowSlots(bookingId: string, bookingWindowDays: number, timeZone: string, durationId?: string, signal?: AbortSignal) {
  return loadRanges(bookingWindowRanges(bookingWindowDays), (range, activeSignal) => frontendApi.getRescheduleSlots(bookingId, range.from, range.to, timeZone, durationId, activeSignal), signal);
}
