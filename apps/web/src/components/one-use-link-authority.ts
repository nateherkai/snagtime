export type OneUseAuthorityName = "token" | "recovery";

export function oneUseAuthorityFromUrl(href: string, name: OneUseAuthorityName) {
  const url = new URL(href);
  const fragment = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);
  const authority = fragment.get(name) ?? url.searchParams.get(name) ?? "";
  fragment.delete(name);
  url.searchParams.delete(name);
  const remainingFragment = fragment.toString();
  url.hash = remainingFragment ? `#${remainingFragment}` : "";
  return { authority, cleanUrl: `${url.pathname}${url.search}${url.hash}` };
}

export function claimOneUseLinkAuthority(name: OneUseAuthorityName) {
  if (typeof window === "undefined") return "";
  const claimed = oneUseAuthorityFromUrl(window.location.href, name);
  if (claimed.authority) window.history.replaceState(window.history.state, "", claimed.cleanUrl);
  return claimed.authority;
}

const inFlightActions = new Map<string, Promise<unknown>>();

export function shareOneUseAction<T>(scope: string, authority: string, action: () => Promise<T>) {
  const key = `${scope}\u0000${authority}`;
  const existing = inFlightActions.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const promise = action().finally(() => {
    if (inFlightActions.get(key) === promise) inFlightActions.delete(key);
  });
  inFlightActions.set(key, promise);
  return promise;
}
