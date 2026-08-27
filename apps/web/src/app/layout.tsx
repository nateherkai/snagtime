import type { Metadata } from "next";
import { AccessibilityFocusManager } from "@/components/accessibility-focus";
import "../styles/globals.css";

export const metadata: Metadata = {
  title: { default: "SnagTime", template: "%s · SnagTime" },
  description: "Snag a time. Get booked.",
  applicationName: "SnagTime",
  icons: { icon: "/icon.svg" },
  manifest: "/manifest.webmanifest",
  openGraph: { title: "SnagTime", description: "Snag a time. Get booked.", type: "website" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" data-scroll-behavior="smooth"><body><AccessibilityFocusManager />{children}</body></html>;
}
