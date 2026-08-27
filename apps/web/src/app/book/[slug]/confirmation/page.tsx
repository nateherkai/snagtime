import { ConfirmationView } from "@/components/booking-outcome";
export const metadata = { title: "Booking confirmed" };
export default async function ConfirmationPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const one = (value: string | string[] | undefined) => typeof value === "string" ? value : undefined;
  return <ConfirmationView slug={slug} bookingId={one(query.booking)} payment={one(query.payment)} readCapability={one(query.read)} cancelCapability={one(query.cancel)} rescheduleCapability={one(query.reschedule)} />;
}
