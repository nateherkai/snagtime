import { redirect } from "next/navigation";
import { VerifyEmailView } from "@/components/account-access";
export const metadata = { title: "Verify email" };
export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) { const { token } = await searchParams; if (token) redirect(`/verify-email#token=${encodeURIComponent(token)}`); return <VerifyEmailView />; }
