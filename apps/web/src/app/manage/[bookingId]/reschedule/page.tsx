import { redirect } from "next/navigation";
import { RescheduleBookingView } from "@/components/booking-outcome";
export const metadata = { title: "Reschedule booking" };
export default async function ReschedulePage({ params, searchParams }: { params: Promise<{ bookingId: string }>; searchParams: Promise<{ slug?: string; recovery?: string; read?: string; capability?: string }> }) {
  const [{ bookingId }, query] = await Promise.all([params, searchParams]);
  if (query.recovery) redirect(`/manage/${encodeURIComponent(bookingId)}/reschedule${query.slug ? `?slug=${encodeURIComponent(query.slug)}` : ""}#recovery=${encodeURIComponent(query.recovery)}`);
  if (query.read || query.capability) redirect(`/manage/${encodeURIComponent(bookingId)}/reschedule${query.slug ? `?slug=${encodeURIComponent(query.slug)}` : ""}`);
  return <RescheduleBookingView bookingId={bookingId} slug={query.slug} />;
}
