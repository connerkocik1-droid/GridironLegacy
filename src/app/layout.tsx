import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./nocturne.css";
import "./globals.css";

// Self-hosted at build time, so the page does not depend on the Google Fonts
// CDN being reachable. Nocturne's tokens name "Inter", which this satisfies.
const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600"], display: "swap" });

export const metadata: Metadata = {
  title: "Gridiron Legacy",
  description: "A twelve-team dynasty superflex league.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.className}>
      <body>{children}</body>
    </html>
  );
}
