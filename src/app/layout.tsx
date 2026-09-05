import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { Inter } from "next/font/google";
import { currentManager } from "@/lib/session";
import AddToHomeScreen from "@/components/AddToHomeScreen";
import LaunchScreen from "@/components/LaunchScreen";
import OfflineBar from "@/components/OfflineBar";
import PullToRefresh from "@/components/PullToRefresh";
import ServiceWorker from "@/components/ServiceWorker";
import TabBar from "@/components/TabBar";
import "./nocturne.css";
// The palette, before anything that names it.
import "./theme.css";
import "./globals.css";

/**
 * Self-hosted at build time, so the page does not depend on the Google Fonts
 * CDN being reachable.
 *
 * As a variable rather than a class, because a class on <html> is overridden
 * by the first `font-family` any stylesheet sets on <body> — and nocturne.css
 * sets one. So this was being loaded on every page and then thrown away, while
 * the literal "Inter" in the tokens was answered by a stylesheet imported from
 * Google at the top of that same file: a render-blocking request to somebody
 * else's CDN, on every page load, for a font already sitting in the build.
 * The tokens name this variable now and that import is gone.
 */
const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
  variable: "--font-inter",
});

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
/**
 * Every iPhone still in use, portrait: [css width, css height, pixel ratio].
 *
 * The same list as scripts/icons/build-launch.mjs, which writes a file for
 * each — they have to agree, and the script's comments say which handset each
 * row is. Landscape is left out on purpose: this app is used one-handed, and a
 * landscape launch is rare enough not to be worth doubling the file count for.
 */
const LAUNCH_SCREENS: [number, number, number][] = [
  [320, 568, 2],
  [375, 667, 2],
  [414, 736, 3],
  [375, 812, 3],
  [414, 896, 2],
  [414, 896, 3],
  [390, 844, 3],
  [428, 926, 3],
  [393, 852, 3],
  [430, 932, 3],
  [402, 874, 3],
  [440, 956, 3],
];

export const viewport: Viewport = {
  // The strip behind the status bar. A meta tag is read by the OS and cannot
  // resolve a custom property — the colour migration turned this into
  // var(--bg), which is a value nothing outside CSS can read — so it is
  // written out, twice, and follows the phone's setting. A manual Light on a
  // phone set to Dark keeps the dark strip: a meta tag cannot see
  // localStorage, and getting the common case right is worth more than a bar
  // that matches in every case.
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#161826" },
    { media: "(prefers-color-scheme: light)", color: "#f1f0f7" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Who is signed in, decided here from the cookie rather than by a request
  // the browser has to make and might not get an answer to. The bottom
  // navigation is the one piece of chrome that must never be missing, and
  // asking the server that already read the session costs nothing this render
  // was not already paying — see TabBar for what it cost not to.
  const manager = await currentManager();
  return (
    // data-theme is written here as well as by the script, so that the markup
    // the server sends already says which palette it is — the stylesheet's
    // default is the dark one, and an element with no attribute at all is a
    // third state nothing in this app describes.
    //
    // suppressHydrationWarning is the other half, and is not cosmetic: the
    // script deliberately changes this element before React hydrates, and
    // React was calling that a mismatch on every single page load. Told to
    // suppress it, React keeps what is in the DOM, which is the whole point of
    // running the script early. It suppresses it for this element only — not
    // for the tree — so a genuine mismatch anywhere else still says so.
    <html lang="en" className={inter.variable} data-theme="dark" suppressHydrationWarning>
      <head>
        {/*
          Which theme, before the first pixel.

          The stylesheet reads data-theme and nothing else, so this has to run
          ahead of the paint: set it afterwards and the page draws dark and
          then flips, which on a home-screen launch is the first thing anybody
          sees. It is the same resolution use-theme.ts does — a stored choice
          if there is one, the phone's setting if there is not — written twice
          on purpose, because the alternative is a flash.

          next/script rather than a bare <script>: React hoists and drops an
          inline script written into the head of a layout, which is a silent
          failure — the page renders, the theme simply never applies.
        */}
        <Script id="pylon-theme" strategy="beforeInteractive">
          {'(function(){try{var c=localStorage.getItem("pylon:theme");' +
            'document.documentElement.dataset.theme=(c==="light"||c==="dark")?c:' +
            '(matchMedia("(prefers-color-scheme: light)").matches?"light":"dark");}' +
            'catch(e){document.documentElement.dataset.theme="dark";}})()'}
        </Script>

        {/* What iOS shows while a home-screen launch is starting.
            
            Not part of the Metadata API, which has no field for these, so they
            are rendered here and React hoists them into the head.
            
            iOS matches on the exact screen and ignores anything that is not
            it — no scaling, no nearest fit — so there is one file per handset
            rather than one file. scripts/icons/build-launch.mjs writes them
            and lists which phone each one is for. */}
        {LAUNCH_SCREENS.map(([w, h, dpr]) => (
          <link
            key={`${w}x${h}@${dpr}`}
            rel="apple-touch-startup-image"
            media={`(device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${dpr}) and (orientation: portrait)`}
            href={`/icons/launch/launch-${w}x${h}@${dpr}x.png`}
          />
        ))}
      </head>
      <body>
        {/* First in the body, so it is the first thing painted and there is no
            frame of empty page between the OS splash and this. */}
        <LaunchScreen />
        {/* Above the page rather than inside it, because the gesture belongs
            to the app and not to whichever board happens to be on screen.
            Renders nothing on a pointer that cannot touch. */}
        <PullToRefresh />
        {children}
        {/* The four places, within a thumb's reach. Phones only — a desktop
            has the same links across the top of the page, and two navigations
            are worse than one wherever they are. */}
        <TabBar signedIn={manager != null} />
        {/* Renders nothing at all except in mobile Safari, to somebody who has
            not already installed it and has not said no. */}
        <AddToHomeScreen />
        {/* Says so when the numbers on screen came out of the worker's cache
            rather than off the wire. Nothing at all when online. */}
        <OfflineBar />
        {/* Installs the offline worker, in production builds only. */}
        <ServiceWorker />
      </body>
    </html>
  );
}
