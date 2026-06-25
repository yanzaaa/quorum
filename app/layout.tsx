import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
  weight: ["400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "Quorum: the agent council that knows when a vote isn't enough",
  description:
    "A multi-agent deliberation system on Qwen. Three agents debate every consequential action and a deterministic quorum guardrail refuses to execute without consensus, escalating the irreversible to a human.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={jakarta.variable}>
      <body>
        <div className="gk-bg" aria-hidden>
          <span className="gk-orb a" />
          <span className="gk-orb b" />
          <span className="gk-orb c" />
          <span className="gk-veil" />
        </div>
        <div className="gk-grid" aria-hidden />
        <div className="gk-grain" aria-hidden />
        {children}
      </body>
    </html>
  );
}
