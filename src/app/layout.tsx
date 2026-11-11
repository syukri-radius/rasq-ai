import type { Metadata } from "next";
import type { ReactNode } from "react";
import { APP_VERSION } from "@/lib/version";
import "./globals.css";

export const metadata: Metadata = {
  title: "RASQ-Ai · Trustworthy visual test automation",
  applicationName: "RASQ-Ai",
  description: "ML-driven, zero-DOM optical test automation: screen recording → visual scan → SRS-traced test cases → n8n-compatible Playwright workflows.",
  other: { version: APP_VERSION },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="bg-slate-50 text-slate-900 antialiased">{children}</body>
    </html>
  );
}
