import type { Metadata } from "next";
import { Plus_Jakarta_Sans, Fraunces } from "next/font/google";
import MatrixRain from "@/components/MatrixRain";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
  weight: ["400", "500", "600", "700", "800"],
});

// Editorial display serif — gives Quorum a "tribunal / deliberation" gravitas that sets it
// apart from the sans-serif sibling projects. Used for the wordmark + section headers.
const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-serif",
  display: "swap",
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: "Quorum: the agent council that knows when a vote isn't enough",
  description:
    "A multi-agent deliberation system on Qwen. Three agents debate every consequential action and a deterministic quorum guardrail refuses to execute without consensus, escalating the irreversible to a human.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${jakarta.variable} ${fraunces.variable}`}>
      <body>
        <div className="qr-bg" aria-hidden />
        <MatrixRain />
        <div className="qr-veil" aria-hidden />
        <div className="qr-grain" aria-hidden />
        {children}
      </body>
    </html>
  );
}
