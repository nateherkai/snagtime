import { redirect } from "next/navigation";

export default async function LegacyConfirmationPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ slug }, incoming] = await Promise.all([params, searchParams]);
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(incoming)) {
    if (typeof value === "string") query.set(key, value);
    else if (Array.isArray(value)) for (const item of value) query.append(key, item);
  }
  const suffix = query.size ? `?${query.toString()}` : "";
  redirect(`/book/${encodeURIComponent(slug)}/confirmation${suffix}`);
}
