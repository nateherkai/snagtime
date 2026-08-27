import type { Metadata } from "next";
import { WorkspaceOnboarding } from "@/components/workspace-onboarding";

export const metadata: Metadata = { title: "Confirm workspace" };
export default function OnboardingPage() { return <WorkspaceOnboarding />; }
