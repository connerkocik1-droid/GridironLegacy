import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import AddToHomeScreen from "@/components/AddToHomeScreen";
import TabBar from "@/components/TabBar";
import "./nocturne.css";
import "./globals.css";

// Self-hosted at build time, so the page does not depend on the Google Fonts
// CDN being reachable. Nocturne's tokens name "Inter", which this satisfies.
const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600"], display: "swap" });

export const metadata: Metadata = {
  title: "Pylon Fantasy",
  description: "A dynasty fantasy football league.",

  /**
   * The half of the home-screen app that the manifest cannot do.
   *
   * iOS reads the manifest for the icon and the name but still decides whether
   * to hide Safari's chrome from these tags, so both halves are needed:
   * without them, adding the site to a home screen gives a bookmark that opens
   * in Safari with the address bar exactly where it was.
   */
  appleWebApp: {
    capable: true,
    title: "Pylon",
    // The status bar becomes part of the page rather than a black strip above
    // it, which is why the layout below pads for the notch.
    statusBarStyle: "black-translucent",
  },

  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    // iOS does not read the manifest for this. With no apple-touch-icon it
    // puts a screenshot of the page on the home screen instead.
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
};

/**
 * The window the app is drawn into.
 *
 * `viewportFit: "cover"` lets the page reach under the notch and the home
 * indicator — which is what makes a standalone launch look like an app rather
 * than a page in a smaller box — and is only safe because the layout pads
 * itself back out with the safe-area insets.
 */
export const viewport: Viewport = {
  themeColor: "#161826",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.className}>
      <body>
        {children}
        {/* The four places, within a thumb's reach. Phones only — a desktop
            has the same links across the top of the page, and two navigations
            are worse than one wherever they are. */}
        <TabBar />
        {/* Renders nothing at all except in mobile Safari, to somebody who has
            not already installed it and has not said no. */}
        <AddToHomeScreen />
      </body>
    </html>
  );
}
