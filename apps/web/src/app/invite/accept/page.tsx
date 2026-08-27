import { redirect } from "next/navigation";
import { AcceptInvitationView } from "@/components/account-access";
export const metadata = { title: "Accept workspace invitation" };
export default async function AcceptInvitationPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) { const { token } = await searchParams; if (token) redirect(`/invite/accept#token=${encodeURIComponent(token)}`); return <AcceptInvitationView />; }
