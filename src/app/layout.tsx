import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "RASQ-Ai · Trustworthy visual test automation",
  description: "ML-driven, zero-DOM optical test automation: screen recording → visual scan → SRS-traced test cases → n8n-compatible Playwright workflows.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-slate-50 text-slate-900 antialiased">{children}</body>
    </html>
  );
}
