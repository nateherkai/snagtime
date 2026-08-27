import { PublicBookingFlow } from "@/components/public-booking-flow";
export const metadata = { title: "Book a time with SnagTime" };
export default async function PublicBookingPage({ params }: { params: Promise<{ slug: string }> }) { const { slug } = await params; return <PublicBookingFlow slug={slug} />; }
