import { redirect } from "next/navigation";

export default async function LegacyPublicBookingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  redirect(`/book/${encodeURIComponent(slug)}`);
}
