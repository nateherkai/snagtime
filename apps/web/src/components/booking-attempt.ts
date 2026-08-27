import type { CreateBookingInput } from "@/lib/contracts";

type StoredBookingAttempt = { fingerprint: string; key: string; bookingId?: string };

function storageKey(slug: string) {
  return `snagtime:booking-attempt:${slug}`;
}

function legacyStorageKey(slug: string) {
  return `tempocove:booking-attempt:${slug}`;
}

function readStoredAttempt(slug: string) {
  const current = sessionStorage.getItem(storageKey(slug));
  if (current) return current;
  const legacy = sessionStorage.getItem(legacyStorageKey(slug));
  if (legacy) {
    sessionStorage.setItem(storageKey(slug), legacy);
    sessionStorage.removeItem(legacyStorageKey(slug));
  }
  return legacy;
}

async function fingerprintInput(input: CreateBookingInput) {
  const encoded = new TextEncoder().encode(JSON.stringify(input));
  const buffer = new ArrayBuffer(encoded.byteLength);
  new Uint8Array(buffer).set(encoded);
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export async function getBookingAttempt(slug: string, input: CreateBookingInput) {
  const fingerprint = await fingerprintInput(input);
  try {
    const stored = JSON.parse(readStoredAttempt(slug) ?? "null") as StoredBookingAttempt | null;
    if (stored?.fingerprint === fingerprint && stored.key) {
      return stored;
    }
    const next = { fingerprint, key: crypto.randomUUID() };
    sessionStorage.setItem(storageKey(slug), JSON.stringify(next));
    return next;
  } catch {
    return { fingerprint, key: crypto.randomUUID() };
  }
}

export function rememberBookingAttempt(slug: string, bookingId: string) {
  try {
    const stored = JSON.parse(readStoredAttempt(slug) ?? "null") as StoredBookingAttempt | null;
    if (stored?.key) sessionStorage.setItem(storageKey(slug), JSON.stringify({ ...stored, bookingId }));
  } catch { /* Storage can be unavailable in hardened browsers. */ }
}

export function clearTerminalBookingAttempt(slug: string) {
  try { sessionStorage.removeItem(storageKey(slug)); sessionStorage.removeItem(legacyStorageKey(slug)); } catch { /* Storage can be unavailable in hardened browsers. */ }
}
