export type SharedRecoveryLoad<T> = { key: string; promise: Promise<T> };
const recoveryLoads = new Map<string, Promise<unknown>>();

export function retainBookingRecoveryAuthority(retained: { current: string }, claim: () => string) {
  const claimed = claim();
  if (claimed) retained.current = claimed;
  return retained.current;
}

export function shareBookingRecoveryLoad<T>(key: string, load: () => Promise<T>): SharedRecoveryLoad<T> {
  const existing = recoveryLoads.get(key) as Promise<T> | undefined;
  if (existing) return { key, promise: existing };
  const promise = load().finally(() => {
    if (recoveryLoads.get(key) === promise) recoveryLoads.delete(key);
  });
  recoveryLoads.set(key, promise);
  return { key, promise };
}
