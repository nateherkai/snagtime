import { redirect } from "next/navigation";
import { ResetPasswordView } from "@/components/account-access";
export const metadata = { title: "Reset password" };
export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) { const { token } = await searchParams; if (token) redirect(`/reset-password#token=${encodeURIComponent(token)}`); return <ResetPasswordView />; }
