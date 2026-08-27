import { redirect } from "next/navigation";
import { CancelBookingView } from "@/components/booking-outcome";
export const metadata = { title: "Cancel booking" };
export default async function CancelPage({ params, searchParams }: { params: Promise<{ bookingId: string }>; searchParams: Promise<{ slug?: string; read?: string; capability?: string }> }) {
  const [{ bookingId }, query] = await Promise.all([params, searchParams]);
  if (query.read || query.capability) redirect(`/manage/${encodeURIComponent(bookingId)}/cancel${query.slug ? `?slug=${encodeURIComponent(query.slug)}` : ""}`);
  return <CancelBookingView bookingId={bookingId} slug={query.slug} />;
}
